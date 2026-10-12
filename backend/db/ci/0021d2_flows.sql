-- 0021-D2 W1 — سيناريوهات الإعداد بعد التطبيق (CI بس، معاملة بترجع)
--
-- • بيتشغّل من backend/db/ci/0021d2_sql_ci.sh بعد تطبيق 0021d2_delivery_settings.sql فوق شكل Production (A1 · D · P1 · P2).
-- • الهويات من shim الـ CI: مالك ...0a · أدمن شغّال ...0b · أدمن موقوف ...0c.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد (فحص الشكل في CI).
-- • المتوقع: PASS بـ 24 نجاح و 0 فشل.

begin;
set local idle_in_transaction_session_timeout = '15s';
set local statement_timeout = '60s';

create temporary table zt_results (n serial, id text, name text, outcome text, detail text) on commit drop;

create function pg_temp.zt(p_name text, p_ok boolean, p_detail text)
returns void language sql as $f$
  insert into pg_temp.zt_results (id, name, outcome, detail)
  values (split_part(p_name, ' ', 1), p_name, case when coalesce(p_ok, false) then 'pass' else 'fail' end, left(coalesce(p_detail, ''), 400));
$f$;

-- النداء بدور وجلسة (sub بدور authenticated، أو من غير جلسة لو NULL). النتيجة نص، أو 'ERR <sqlstate> <detail>'.
create function pg_temp.call_as(p_role text, p_sub text, p_sql text)
returns text language plpgsql as $f$
declare
  r text;
  v_state text;
  v_detail text;
begin
  begin
    perform pg_catalog.set_config('request.jwt.claims',
      case when p_sub is null then '' else pg_catalog.jsonb_build_object('sub', p_sub, 'role', 'authenticated')::text end, true);
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claim.role', '', true);
    execute 'set local role ' || pg_catalog.quote_ident(p_role);
    execute p_sql into r;
    execute 'reset role';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    return 'ERR ' || v_state || ' ' || coalesce(v_detail, '');
  end;
  return coalesce(r, 'null');
end
$f$;

create function pg_temp.save_sql(p_ts timestamptz, p_choice text, p_note text, p_text text)
returns text language sql as $f$
  select pg_catalog.format('select public.zell_delivery_settings_save(%L::timestamptz, %L::boolean, %L::boolean, %L::text)::text',
                           p_ts, p_choice, p_note, p_text);
$f$;

create function pg_temp.js(p text) returns jsonb language sql as $f$
  select case when p is null or p like 'ERR%' or p = 'null' then null else p::jsonb end;
$f$;

-- A) القيم بعد التطبيق · الصلاحيات · الهوية
do $zA$
declare
  v_owner text := '00000000-0000-0000-0000-00000000000a';
  v_admin text := '00000000-0000-0000-0000-00000000000b';
  v_off text := '00000000-0000-0000-0000-00000000000c';
  v_get text := 'select public.zell_delivery_settings_get()::text';
  v_chk text := 'select public.zell_checkout_delivery_settings()::text';
  v_save text;
  v_ts timestamptz;
  v_r text;
begin
  select s.updated_at into v_ts from public.zell_delivery_settings s where s.id;
  v_save := pg_temp.save_sql(v_ts, 'true', 'false', null);

  v_r := pg_temp.call_as('service_role', null, v_chk);
  perform pg_temp.zt('F01 checkout read after apply = current behaviour (choice on, no note)',
    pg_temp.js(v_r) = '{"customer_choice_enabled": true, "note": null}'::jsonb, v_r);
  v_r := pg_temp.call_as('authenticated', v_owner, v_get);
  perform pg_temp.zt('F02 owner get: choice on, note off, no text, updated_at = the row',
    pg_temp.js(v_r) ->> 'customer_choice_enabled' = 'true' and pg_temp.js(v_r) ->> 'note_enabled' = 'false'
    and pg_temp.js(v_r) -> 'note_text' = 'null'::jsonb and (pg_temp.js(v_r) ->> 'updated_at')::timestamptz = v_ts, v_r);
  v_r := pg_temp.call_as('authenticated', v_admin, v_get);
  perform pg_temp.zt('F03 active admin can read the setting', pg_temp.js(v_r) ? 'customer_choice_enabled', v_r);
  perform pg_temp.zt('F04 get: no session -> 45400 · inactive admin -> 45401',
    pg_temp.call_as('authenticated', null, v_get) like 'ERR 45400%'
    and pg_temp.call_as('authenticated', v_off, v_get) like 'ERR 45401%', null);
  v_r := pg_temp.call_as('authenticated', v_admin, v_save);
  perform pg_temp.zt('F05 admin save -> 45402 (owner only)', v_r like 'ERR 45402%', v_r);
  perform pg_temp.zt('F06 EXECUTE: anon nothing · service_role checkout only · authenticated not checkout',
    pg_temp.call_as('anon', null, v_get) like 'ERR 42501%'
    and pg_temp.call_as('anon', null, v_save) like 'ERR 42501%'
    and pg_temp.call_as('anon', null, v_chk) like 'ERR 42501%'
    and pg_temp.call_as('service_role', null, v_get) like 'ERR 42501%'
    and pg_temp.call_as('service_role', null, v_save) like 'ERR 42501%'
    and pg_temp.call_as('authenticated', v_owner, v_chk) like 'ERR 42501%', null);
  perform pg_temp.zt('F07 no direct table access for anon / authenticated / service_role',
    pg_temp.call_as('anon', null, 'select count(*)::text from public.zell_delivery_settings') like 'ERR 42501%'
    and pg_temp.call_as('authenticated', v_owner, 'select count(*)::text from public.zell_delivery_settings') like 'ERR 42501%'
    and pg_temp.call_as('service_role', null, 'select count(*)::text from public.zell_delivery_settings') like 'ERR 42501%'
    and pg_temp.call_as('anon', null, 'select count(*)::text from public.zell_delivery_settings_log') like 'ERR 42501%'
    and pg_temp.call_as('authenticated', v_owner, 'select count(*)::text from public.zell_delivery_settings_log') like 'ERR 42501%'
    and pg_temp.call_as('service_role', null, 'select count(*)::text from public.zell_delivery_settings_log') like 'ERR 42501%', null);
  perform pg_temp.zt('F08 refused calls wrote nothing (log empty, row unchanged)',
    (select count(*) from public.zell_delivery_settings_log) = 0
    and (select s.updated_at = v_ts and s.customer_choice_enabled and not s.note_enabled and s.note_text is null and s.updated_by is null
           from public.zell_delivery_settings s where s.id), null);
exception when others then
  perform pg_temp.zt('ABORT_A block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zA$;

-- B) النسخة والتحقق (45404 · 45430 بالحقل)
do $zB$
declare
  v_owner text := '00000000-0000-0000-0000-00000000000a';
  v_ts timestamptz;
  r1 text;
  r2 text;
  r3 text;
  r4 text;
  r5 text;
  r6 text;
begin
  select s.updated_at into v_ts from public.zell_delivery_settings s where s.id;
  r1 := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(v_ts - interval '1 millisecond', 'false', 'false', null));
  r2 := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(null, 'false', 'false', null));
  perform pg_temp.zt('F10 stale or missing version -> 45404', r1 like 'ERR 45404%' and r2 like 'ERR 45404%', r1 || ' / ' || r2);
  r1 := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(v_ts, 'true', 'true', '   '));
  r2 := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(v_ts, 'true', 'true', null));
  r6 := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(v_ts, 'true', 'true', E' \n\t\r '));
  perform pg_temp.zt('F11 note on with an empty note (spaces / null / newlines) -> 45430 note_text',
    r1 = 'ERR 45430 note_text' and r2 = 'ERR 45430 note_text' and r6 = 'ERR 45430 note_text', r1 || ' / ' || r2 || ' / ' || r6);
  r3 := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(v_ts, 'true', 'false', pg_catalog.repeat('x', 301)));
  perform pg_temp.zt('F12 note longer than 300 after trim -> 45430 note_text (even with the note off)', r3 = 'ERR 45430 note_text', r3);
  r4 := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(v_ts, null, 'false', null));
  r5 := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(v_ts, 'true', null, null));
  perform pg_temp.zt('F13 null switches -> 45430 with the field',
    r4 = 'ERR 45430 customer_choice_enabled' and r5 = 'ERR 45430 note_enabled', r4 || ' / ' || r5);
  perform pg_temp.zt('F14 refused saves wrote nothing',
    (select count(*) from public.zell_delivery_settings_log) = 0
    and (select s.updated_at = v_ts and s.customer_choice_enabled and not s.note_enabled and s.note_text is null
           from public.zell_delivery_settings s where s.id), null);
exception when others then
  perform pg_temp.zt('ABORT_B block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zB$;

-- C) الحفظ الصح · السجل · قراية المتجر
do $zC$
declare
  v_owner text := '00000000-0000-0000-0000-00000000000a';
  v_note text := 'هنتواصل معاك نحدد ميعاد التسليم';
  v_chk text := 'select public.zell_checkout_delivery_settings()::text';
  v_ts0 timestamptz;
  v_ts1 timestamptz;
  v_r text;
  v_log record;
begin
  select s.updated_at into v_ts0 from public.zell_delivery_settings s where s.id;
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(v_ts0, 'false', 'true', E'  \n' || v_note || '  '));
  select s.updated_at into v_ts1 from public.zell_delivery_settings s where s.id;
  perform pg_temp.zt('F20 owner save: choice off + note on, text trimmed, version bumped, updated_by = owner, changed = true',
    (select not s.customer_choice_enabled and s.note_enabled and s.note_text = v_note and s.updated_by = v_owner::uuid
       from public.zell_delivery_settings s where s.id)
    and v_ts1 > v_ts0
    and pg_temp.js(v_r) ->> 'note_text' = v_note and (pg_temp.js(v_r) ->> 'updated_at')::timestamptz = v_ts1
    and pg_temp.js(v_r) ->> 'changed' = 'true', v_r);
  select l.actor, l.old_value, l.new_value into v_log from public.zell_delivery_settings_log l order by l.id desc limit 1;
  perform pg_temp.zt('F21 one log row: actor owner, old = before, new = after',
    (select count(*) from public.zell_delivery_settings_log) = 1
    and v_log.actor = v_owner::uuid
    and v_log.old_value = '{"customer_choice_enabled": true, "note_enabled": false, "note_text": null}'::jsonb
    and v_log.new_value = pg_catalog.jsonb_build_object('customer_choice_enabled', false, 'note_enabled', true, 'note_text', v_note),
    v_log.new_value::text);
  v_r := pg_temp.call_as('service_role', null, v_chk);
  perform pg_temp.zt('F22 checkout read: choice off, note shown',
    pg_temp.js(v_r) = pg_catalog.jsonb_build_object('customer_choice_enabled', false, 'note', v_note), v_r);
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(v_ts1, 'false', 'true', v_note));
  perform pg_temp.zt('F23 save with no change: no log row, changed = false',
    pg_temp.js(v_r) ->> 'changed' = 'false' and (select count(*) from public.zell_delivery_settings_log) = 1
    and (select s.updated_at from public.zell_delivery_settings s where s.id) = v_ts1, v_r);
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(v_ts0, 'true', 'false', null));
  perform pg_temp.zt('F24 save with the version from before the change -> 45404, nothing changed',
    v_r like 'ERR 45404%' and (select count(*) from public.zell_delivery_settings_log) = 1, v_r);
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(v_ts1, 'false', 'true', '  ' || pg_catalog.repeat('م', 300) || '  '));
  perform pg_temp.zt('F25 exactly 300 characters after trim (Arabic) accepted',
    v_r not like 'ERR%'
    and (select pg_catalog.char_length(s.note_text) = 300 from public.zell_delivery_settings s where s.id)
    and (select count(*) from public.zell_delivery_settings_log) = 2, v_r);
  select s.updated_at into v_ts1 from public.zell_delivery_settings s where s.id;
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(v_ts1, 'true', 'false', v_note));
  perform pg_temp.zt('F26 note off keeps the text: checkout note null, get keeps note_text',
    pg_temp.js(pg_temp.call_as('service_role', null, v_chk)) = '{"customer_choice_enabled": true, "note": null}'::jsonb
    and pg_temp.js(pg_temp.call_as('authenticated', v_owner, 'select public.zell_delivery_settings_get()::text')) ->> 'note_text' = v_note
    and (select count(*) from public.zell_delivery_settings_log) = 3, v_r);
  select s.updated_at into v_ts1 from public.zell_delivery_settings s where s.id;
  v_r := pg_temp.call_as('authenticated', v_owner, pg_temp.save_sql(v_ts1, 'true', 'false', '   '));
  perform pg_temp.zt('F27 empty text with the note off -> stored NULL (= current behaviour again)',
    (select s.customer_choice_enabled and not s.note_enabled and s.note_text is null from public.zell_delivery_settings s where s.id)
    and (select count(*) from public.zell_delivery_settings_log) = 4, v_r);
exception when others then
  perform pg_temp.zt('ABORT_C block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zC$;

-- D) الثبات والقيود (كـ postgres، مالك الجداول)
do $zD$
declare
  v_owner uuid := '00000000-0000-0000-0000-00000000000a';
  e1 text;
  e2 text;
  e3 text;
  e4 text;
  e5 text;
  e6 text;
  e7 text;
begin
  begin update public.zell_delivery_settings_log set actor = actor; e1 := 'none'; exception when others then e1 := sqlstate; end;
  begin delete from public.zell_delivery_settings_log; e2 := 'none'; exception when others then e2 := sqlstate; end;
  begin truncate public.zell_delivery_settings_log; e3 := 'none'; exception when others then e3 := sqlstate; end;
  perform pg_temp.zt('F30 log append-only: UPDATE / DELETE / TRUNCATE -> 45413',
    e1 = '45413' and e2 = '45413' and e3 = '45413', e1 || ',' || e2 || ',' || e3);
  begin delete from public.zell_delivery_settings; e4 := 'none'; exception when others then e4 := sqlstate; end;
  begin truncate public.zell_delivery_settings; e5 := 'none'; exception when others then e5 := sqlstate; end;
  begin
    insert into public.zell_delivery_settings (id, customer_choice_enabled, note_enabled) values (false, true, false);
    e6 := 'none';
  exception when others then e6 := sqlstate;
  end;
  begin update public.zell_delivery_settings set note_enabled = true, note_text = null; e7 := 'none'; exception when others then e7 := sqlstate; end;
  perform pg_temp.zt('F31 settings row: no DELETE / TRUNCATE (45413), no second row, note on needs a text (23514)',
    e4 = '45413' and e5 = '45413' and e6 in ('23514', '23505') and e7 = '23514', e4 || ',' || e5 || ',' || e6 || ',' || e7);
  perform pg_temp.zt('F32 log: one row per real change, all by the owner, values well formed',
    (select count(*) from public.zell_delivery_settings_log) = 4
    and not exists (select 1 from public.zell_delivery_settings_log l
                     where l.actor <> v_owner
                        or (select count(*) from pg_catalog.jsonb_object_keys(l.new_value)) <> 3
                        or (select count(*) from pg_catalog.jsonb_object_keys(l.old_value)) <> 3), null);
exception when others then
  perform pg_temp.zt('ABORT_D block raised an unexpected error', false, sqlstate || ' ' || sqlerrm);
end
$zD$;

select 0::integer as ord, 'summary'::text as kind, null::text as test_id, null::text as test_name, null::text as outcome, null::text as detail,
       (select count(*) from pg_temp.zt_results where outcome = 'pass') as pass,
       (select count(*) from pg_temp.zt_results where outcome = 'fail') as fail,
       case when (select count(*) from pg_temp.zt_results where outcome = 'fail') = 0
             and (select count(*) from pg_temp.zt_results where outcome = 'pass') = 24 then 'PASS' else 'FAIL' end as verdict
union all
select r.n, 'test', r.id, r.name, r.outcome, r.detail, null, null, null
  from pg_temp.zt_results r
order by 1;

rollback;
