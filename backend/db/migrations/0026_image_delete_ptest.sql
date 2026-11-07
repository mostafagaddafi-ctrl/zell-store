-- 0026 IMAGE-DELETE — اختبار قبل التطبيق (smoke على Production) لـ 0026_image_delete.sql
--
-- • قبل التطبيق بس، وإلا ZELL_0026_PTEST_PRE_APPLY_ONLY.
-- • معاملة واحدة: أول جملة begin وآخر جملة rollback، والنتيجة صفوف في SELECT واحد. الجسم منسوخ بالحرف (md5 في CI).
-- • الأثر على Production: كله جوه المعاملة وبيترجع. مفيش كتابة بيانات: الفحوص على الكتالوج، وبصمة صور المنتجات
--   وstorage_orphans وظهور المنتجات قبل الجسم وبعده، ونداء واحد من غير جلسة بيترفض قبل أي كتابة.
--   السيناريوهات الكبيرة والتزامن في CI: backend/db/ci/0026_flows.sql + backend/db/ci/0026_sql_ci.sh.
-- • الأقفال: الجسم بياخد أقفال DDL قصيرة على products وproduct_images وstorage_orphans (lock_timeout 5s).
-- • المتوقع: PASS بـ 6 نجاح و 0 فشل.

begin;
set local idle_in_transaction_session_timeout = '15s';
set local zell.approved_by = 'ptest-0026';

do $zguard$
begin
  if pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)') is not null
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard') then
    raise exception 'ZELL_0026_PTEST_PRE_APPLY_ONLY';
  end if;
  perform pg_catalog.set_config('zell.pt0026_fp', pg_catalog.md5(pg_catalog.concat_ws('|',
      (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, ',' order by t.id), '')) from public.product_images t),
      (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, ',' order by t.id), '')) from public.storage_orphans t),
      (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t.id::text || ':' || t.is_active::text, ',' order by t.id), '')) from public.products t))), true);
end
$zguard$;

-- >>> 0026 BODY
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- (0) preflight: المتصل · الموافقة · المتطلبات · مش متطبّق قبل كده · الأكواد 45701..45705 مش مستخدمة · قيد الأسباب ·
--     خط أساس 0022 بالنص: كل إدخالات ACL للدور ولـ PUBLIC على الجداول التلاتة وأعمدتها (كل أنواع الصلاحيات + grant options) ·
--     صفات الدور وعضوياته وUSAGE/CREATE على public · كل policies الجداول دي اللي بتنطبق عليه.
--     أي اختلاف = وقف قبل أي تغيير (ZELL_0026_BASELINE_DRIFT، والقيمة الفعلية في detail).
do $idpre$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
  v_con text;
  v_g text;
  v_p text;
  v_r text;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0026_WRONG_CALLER';
  end if;
  if v_by = '' or pg_catalog.char_length(v_by) > 120 then
    raise exception 'ZELL_0026_APPROVAL_MISSING';
  end if;
  if pg_catalog.to_regrole('zell_catalog_definer') is null
     or pg_catalog.to_regprocedure('public.zell_order_actor(boolean)') is null
     or pg_catalog.to_regprocedure('public.zell_product_delete(integer, timestamp with time zone)') is null
     or pg_catalog.to_regprocedure('public.zell_set_primary_product_image(integer, bigint)') is null
     or pg_catalog.to_regclass('public.storage_orphans') is null
     or pg_catalog.to_regclass('public.product_images') is null
     or not exists (select 1 from pg_catalog.pg_attribute a
                     where a.attrelid = 'public.product_images'::regclass and a.attname = 'fit' and not a.attisdropped)
     or not pg_catalog.has_function_privilege('zell_catalog_definer', 'public.zell_order_actor(boolean)', 'EXECUTE')
     or not exists (select 1 from pg_catalog.pg_constraint c
                     where c.conrelid = 'public.product_images'::regclass and c.conname = 'product_images_object_unique' and c.contype = 'u')
     or not exists (select 1 from pg_catalog.pg_constraint c
                     where c.conrelid = 'public.storage_orphans'::regclass and c.conname = 'storage_orphans_object_unique' and c.contype = 'u') then
    raise exception 'ZELL_0026_PREREQ_MISSING';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('zell_product_image_delete', 'zell_catalog_trg_products_activation_guard'))
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard')
     or exists (select 1 from pg_catalog.pg_policies p
                 where p.schemaname = 'public'
                   and p.policyname in ('zell_catalog_definer_image_delete', 'zell_catalog_definer_image_promote',
                                        'zell_catalog_definer_insert_removed')) then
    raise exception 'ZELL_0026_ALREADY_APPLIED';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p where p.prosrc ~ '4570[1-5]') then
    raise exception 'ZELL_0026_CODE_TAKEN';
  end if;
  select pg_catalog.pg_get_constraintdef(c.oid) into v_con
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.storage_orphans'::regclass and c.conname = 'storage_orphans_reason_check';
  if v_con is distinct from 'CHECK ((reason = ANY (ARRAY[''insert_failed''::text, ''delete_failed''::text, ''replaced''::text, ''removed''::text, ''product_deleted''::text])))' then
    raise exception 'ZELL_0026_ORPHAN_REASON_SHAPE' using detail = coalesce(v_con, '(missing)');
  end if;
  v_g := (select pg_catalog.string_agg(t.n
         || ':REL=' || coalesce((select pg_catalog.string_agg(e.s, ',' order by e.s collate "C")
                                   from (select case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee)::text end || '/' || x.privilege_type || case when x.is_grantable then '*' else '' end as s
                                           from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) x
                                          where c.oid = t.o and (x.grantee = 0 or x.grantee = 'zell_catalog_definer'::regrole)) e), '')
         || ';COL=' || coalesce((select pg_catalog.string_agg(e.s, ',' order by e.s collate "C")
                                   from (select a.attname::text || ':' || case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee)::text end || '/' || x.privilege_type || case when x.is_grantable then '*' else '' end as s
                                           from pg_catalog.pg_attribute a, pg_catalog.aclexplode(a.attacl) x
                                          where a.attrelid = t.o and a.attnum > 0 and not a.attisdropped
                                            and (x.grantee = 0 or x.grantee = 'zell_catalog_definer'::regrole)) e), ''),
       ' | ' order by t.n collate "C")
     from (values ('product_images'::text, 'public.product_images'::regclass::oid),
                  ('products'::text, 'public.products'::regclass::oid),
                  ('storage_orphans'::text, 'public.storage_orphans'::regclass::oid)) t(n, o));
  if v_g is distinct from 'product_images:REL=;COL=bucket:zell_catalog_definer/SELECT,id:zell_catalog_definer/SELECT,object_path:zell_catalog_definer/SELECT,product_id:zell_catalog_definer/SELECT,product_id:zell_catalog_definer/UPDATE | products:REL=zell_catalog_definer/DELETE;COL=id:zell_catalog_definer/SELECT,is_active:zell_catalog_definer/SELECT,updated_at:zell_catalog_definer/SELECT,updated_at:zell_catalog_definer/UPDATE | storage_orphans:REL=;COL=bucket:zell_catalog_definer/INSERT,bucket:zell_catalog_definer/SELECT,cleaned_at:zell_catalog_definer/SELECT,cleaned_at:zell_catalog_definer/UPDATE,id:zell_catalog_definer/SELECT,object_path:zell_catalog_definer/INSERT,object_path:zell_catalog_definer/SELECT,reason:zell_catalog_definer/INSERT' then
    raise exception 'ZELL_0026_BASELINE_DRIFT' using detail = 'acl: ' || coalesce(v_g, '(null)');
  end if;
  v_r := (select 'super=' || r.rolsuper::text || ' inherit=' || r.rolinherit::text || ' createrole=' || r.rolcreaterole::text
         || ' createdb=' || r.rolcreatedb::text || ' login=' || r.rolcanlogin::text || ' replication=' || r.rolreplication::text
         || ' bypassrls=' || r.rolbypassrls::text
         || ' memberof=' || coalesce((select pg_catalog.string_agg(g.rolname::text, ',' order by g.rolname::text collate "C")
                                        from pg_catalog.pg_auth_members m join pg_catalog.pg_roles g on g.oid = m.roleid
                                       where m.member = r.oid), '')
         || ' members=' || coalesce((select pg_catalog.string_agg(y.s, ';' order by y.s collate "C")
                                       from (select mm.rolname::text || ':inherit=' || pg_catalog.bool_or(m.inherit_option)::text
                                                    || ',set=' || pg_catalog.bool_or(m.set_option)::text as s
                                               from pg_catalog.pg_auth_members m join pg_catalog.pg_roles mm on mm.oid = m.member
                                              where m.roleid = r.oid group by mm.rolname) y), '')
         || ' schema_usage=' || pg_catalog.has_schema_privilege(r.oid, 'public', 'USAGE')::text
         || ' schema_create=' || pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE')::text
     from pg_catalog.pg_roles r where r.rolname = 'zell_catalog_definer');
  if v_r is distinct from 'super=false inherit=false createrole=false createdb=false login=false replication=false bypassrls=false memberof= members=postgres:inherit=false,set=true schema_usage=true schema_create=false' then
    raise exception 'ZELL_0026_BASELINE_DRIFT' using detail = 'role: ' || coalesce(v_r, '(null)');
  end if;
  v_p := (select pg_catalog.string_agg(p.tablename::text || '.' || p.policyname::text || ':' || p.cmd || ':' || p.permissive || ':'
         || pg_catalog.array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'),
       ' | ' order by p.tablename::text collate "C", p.policyname::text collate "C")
     from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename in ('product_images', 'products', 'storage_orphans')
      and p.roles && array['zell_catalog_definer', 'public']::name[]);
  if v_p is distinct from 'product_images.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | product_images.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_delete:DELETE:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | products.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | storage_orphans.zell_catalog_definer_insert:INSERT:PERMISSIVE:zell_catalog_definer:-:((reason = ''product_deleted''::text) AND (cleaned_at IS NULL)) | storage_orphans.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | storage_orphans.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:-' then
    raise exception 'ZELL_0026_BASELINE_DRIFT' using detail = 'policies: ' || coalesce(v_p, '(null)');
  end if;
end
$idpre$;

-- (1) أقل صلاحيات (العقد §٤): على product_images بس، وpolicies جديدة باسم zell_catalog_definer_*.
--     سحب UPDATE (product_id): منحة 0022 للقفل بس؛ مع policy الترقية (الـ policies المسموحة بتتجمع بـ OR) كانت هتسمح
--     بتغيير product_id لصورة رئيسية. القفل على الصور بيفضل بمنحة UPDATE الجديدة. الرجوع بيرجّعها بالظبط.
grant select (kind, is_primary, sort_order), update (is_primary, fit, updated_at), delete
  on table public.product_images to zell_catalog_definer;
revoke update (product_id) on table public.product_images from zell_catalog_definer;
create policy zell_catalog_definer_image_delete on public.product_images
  for delete to zell_catalog_definer using (true);
create policy zell_catalog_definer_image_promote on public.product_images
  for update to zell_catalog_definer using (true) with check (is_primary and fit = 'cover' and kind = 'gallery');
create policy zell_catalog_definer_insert_removed on public.storage_orphans
  for insert to zell_catalog_definer with check (reason = 'removed' and cleaned_at is null);

-- (2) الدالتين، مالكهم zell_catalog_definer (CREATE على السكيما مؤقت حوالين الإنشاء بس، زي 0023).
grant create on schema public to zell_catalog_definer;
set local role zell_catalog_definer;

-- حذف صورة واحدة (العقد §٢–§٥): المالك بس · المنتج for update ← صوره for update ← سجل الملف nowait ← القرار بعد الأقفال ·
-- التسجيل ← المسح ← الترقية ← فحص أخير fail-closed.
create function public.zell_product_image_delete(p_product_id integer, p_image_id bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '3s' as $fn$
declare
  v_actor uuid := public.zell_order_actor(true);
  v_pid integer;
  v_active boolean;
  v_bucket text;
  v_path text;
  v_kind text;
  v_primary boolean;
  v_remaining integer;
  v_primaries_before integer;
  v_primaries_after integer;
  v_cleaned boolean;
  v_has_orphan boolean := false;
  v_recorded boolean := false;
  v_n integer := 0;
  v_promoted bigint;
begin
  if p_product_id is null or p_image_id is null then
    raise exception 'ZELL_IMAGE_NOT_FOUND' using errcode = '45701';
  end if;

  -- (1) صف المنتج for update: بيمنع التفعيل، وإضافة صورة جديدة (FOR KEY SHARE من فحص الـ FK) لحد الـ commit.
  begin
    select p.id into v_pid from public.products p where p.id = p_product_id for update;
  exception when lock_not_available then
    raise exception 'ZELL_IMAGE_BUSY' using errcode = '45704', detail = 'product';
  end;
  if v_pid is null then
    raise exception 'ZELL_IMAGE_NOT_FOUND' using errcode = '45701';
  end if;

  -- (2) كل صور المنتج for update (نفس اللي zell_set_primary_product_image و zell_reorder_product_images بيقفلوه).
  begin
    perform 1 from public.product_images i where i.product_id = p_product_id for update;
  exception when lock_not_available then
    raise exception 'ZELL_IMAGE_BUSY' using errcode = '45704', detail = 'images';
  end;

  -- (3) الصورة نفسها (بعد القفل).
  select i.bucket, i.object_path, i.kind, i.is_primary
    into v_bucket, v_path, v_kind, v_primary
    from public.product_images i
   where i.id = p_image_id and i.product_id = p_product_id;
  if not found then
    raise exception 'ZELL_IMAGE_NOT_FOUND' using errcode = '45701';
  end if;

  -- (4) سجل الملف nowait (القيد storage_orphans_object_unique = سجل واحد للمسار).
  begin
    select (o.cleaned_at is not null) into v_cleaned
      from public.storage_orphans o
     where o.bucket = v_bucket and o.object_path = v_path
       for update nowait;
    v_has_orphan := found;
  exception when lock_not_available then
    raise exception 'ZELL_IMAGE_BUSY' using errcode = '45704', detail = 'orphan';
  end;

  -- (5) القرار بعد الأقفال: is_active وعدد صور المعرض الباقية بلقطة جديدة.
  select p.is_active into v_active from public.products p where p.id = p_product_id;
  select pg_catalog.count(*) into v_primaries_before
    from public.product_images i
   where i.product_id = p_product_id and i.kind = 'gallery' and i.is_primary;
  if v_kind = 'gallery' then
    select pg_catalog.count(*) into v_remaining
      from public.product_images i
     where i.product_id = p_product_id and i.kind = 'gallery' and i.id <> p_image_id;
    if v_active and v_remaining = 0 then
      raise exception 'ZELL_IMAGE_LAST_VISIBLE' using errcode = '45702';
    end if;
  end if;
  if v_has_orphan and v_cleaned then
    raise exception 'ZELL_IMAGE_ORPHAN_CONFLICT' using errcode = '45703';
  end if;

  -- (6) تسجيل الملف قبل مسح الصف (مفيش مسح من Storage). سجل موجود cleaned_at is null = مفيش تغيير.
  --     سجل لنفس المسار بيتدخل في معاملة تانية: unique_violation أو انتهاء المهلة = 45704.
  if not v_has_orphan then
    begin
      insert into public.storage_orphans (bucket, object_path, reason) values (v_bucket, v_path, 'removed');
      v_recorded := true;
    exception when unique_violation or lock_not_available then
      raise exception 'ZELL_IMAGE_BUSY' using errcode = '45704', detail = 'orphan_insert';
    end;
  end if;

  -- (7) مسح الصف.
  delete from public.product_images i where i.id = p_image_id and i.product_id = p_product_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'ZELL_IMAGE_NOT_FOUND' using errcode = '45701';
  end if;

  -- (8) لو كانت الرئيسية: أول صورة معرض باقية حسب الترتيب (sort_order ثم id) بتبقى رئيسية cover.
  if v_primary then
    select i.id into v_promoted
      from public.product_images i
     where i.product_id = p_product_id and i.kind = 'gallery'
     order by i.sort_order, i.id
     limit 1;
    if v_promoted is not null then
      update public.product_images i
         set is_primary = true, fit = 'cover', updated_at = pg_catalog.now()
       where i.id = v_promoted and i.product_id = p_product_id and i.kind = 'gallery';
      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception 'ZELL_IMAGE_BUSY' using errcode = '45704', detail = 'promotion';
      end if;
    end if;
  end if;

  -- (9) فحص أخير (fail-closed): منتج ظاهر كان ليه رئيسية من المعرض لازم يخلص بـ رئيسية واحدة بالظبط.
  select pg_catalog.count(*) into v_primaries_after
    from public.product_images i
   where i.product_id = p_product_id and i.kind = 'gallery' and i.is_primary;
  if v_active and v_primaries_before >= 1 and v_primaries_after <> 1 then
    raise exception 'ZELL_IMAGE_BUSY' using errcode = '45704', detail = 'no_primary_after';
  end if;

  return pg_catalog.jsonb_build_object(
    'deleted_image_id', p_image_id,
    'promoted_image_id', v_promoted,
    'orphan_recorded', v_recorded);
end
$fn$;

-- حارس التفعيل (العقد §٥-ب): الانتقال لظاهر (insert ظاهر، أو is_active من غير true لـ true) محتاج رئيسية من المعرض.
create function public.zell_catalog_trg_products_activation_guard()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.is_active is true then
    if tg_op = 'UPDATE' then
      if old.is_active is true then
        return new;
      end if;
    end if;
    if not exists (select 1 from public.product_images i
                    where i.product_id = new.id and i.kind = 'gallery' and i.is_primary) then
      raise exception 'ZELL_PRODUCT_NEEDS_PRIMARY_IMAGE' using errcode = '45705';
    end if;
  end if;
  return new;
end
$fn$;

reset role;

-- (3) الـ trigger قبل سحب EXECUTE من PUBLIC: CREATE TRIGGER بيطلب EXECUTE على الدالة للي بينشئه (زي 0022).
create trigger zell_catalog_products_activation_guard
  before insert or update of is_active on public.products
  for each row execute function public.zell_catalog_trg_products_activation_guard();

set local role zell_catalog_definer;
revoke all on function public.zell_product_image_delete(integer, bigint),
  public.zell_catalog_trg_products_activation_guard()
  from public, anon, authenticated, service_role;
grant execute on function public.zell_product_image_delete(integer, bigint) to authenticated;
reset role;
revoke create on schema public from zell_catalog_definer;

-- (4) postflight: المالك · security definer · الإعدادات · الصلاحيات بالظبط (من غير grant option) · الـ trigger ·
--     ACL الجداول والدالتين وصفات الدور والـ policies بالنص الكامل. أي شرط فاشل بيتكتب اسمه في detail (القايمة كاملة).
do $idpost$
declare
  v_del oid := pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)');
  v_trg oid := pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()');
  v_att smallint := (select a.attnum from pg_catalog.pg_attribute a
                      where a.attrelid = 'public.products'::regclass and a.attname = 'is_active');
  v_bad text[] := '{}';
  v_g text;
  v_p text;
  v_r text;
  v_f text;
begin
  if v_del is null or v_trg is null then
    raise exception 'ZELL_0026_POST_SHAPE' using detail = 'functions_missing';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p where p.oid in (v_del, v_trg)
                and (pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_catalog_definer' or not p.prosecdef)) then
    v_bad := v_bad || 'owner_secdef'::text;
  end if;
  if (select p.proconfig from pg_catalog.pg_proc p where p.oid = v_del) is distinct from array['search_path=""', 'lock_timeout=3s'] then
    v_bad := v_bad || 'delete_config'::text;
  end if;
  if (select p.proconfig from pg_catalog.pg_proc p where p.oid = v_trg) is distinct from array['search_path=""'] then
    v_bad := v_bad || 'trigger_fn_config'::text;
  end if;
  if not pg_catalog.has_function_privilege('authenticated', v_del, 'EXECUTE')
     or exists (select 1 from (values ('anon'), ('service_role')) r(n) where pg_catalog.has_function_privilege(r.n, v_del, 'EXECUTE'))
     or exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(n) where pg_catalog.has_function_privilege(r.n, v_trg, 'EXECUTE')) then
    v_bad := v_bad || 'execute_roles'::text;
  end if;
  v_f := (select pg_catalog.string_agg(f.n || '=' || case when p.oid is null then '-' when p.proacl is null then 'DEFAULT'
           else coalesce((select pg_catalog.string_agg(e.s, ',' order by e.s collate "C")
                            from (select case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee)::text end || '/' || x.privilege_type || case when x.is_grantable then '*' else '' end as s from pg_catalog.aclexplode(p.proacl) x where x.grantee <> p.proowner) e), '') end,
       ' | ' order by f.n collate "C")
     from (values ('delete'::text, pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)')::oid),
                  ('trigger'::text, pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()')::oid)) f(n, o)
     left join pg_catalog.pg_proc p on p.oid = f.o);
  if v_f is distinct from 'delete=authenticated/EXECUTE | trigger=' then
    v_bad := v_bad || ('function_acl: ' || coalesce(v_f, '(null)'));
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t
                  where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard'
                    and t.tgenabled = 'O' and t.tgfoid = v_trg and t.tgtype = 23
                    and t.tgattr::text = v_att::text) then
    v_bad := v_bad || 'trigger_shape'::text;
  end if;
  v_g := (select pg_catalog.string_agg(t.n
         || ':REL=' || coalesce((select pg_catalog.string_agg(e.s, ',' order by e.s collate "C")
                                   from (select case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee)::text end || '/' || x.privilege_type || case when x.is_grantable then '*' else '' end as s
                                           from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) x
                                          where c.oid = t.o and (x.grantee = 0 or x.grantee = 'zell_catalog_definer'::regrole)) e), '')
         || ';COL=' || coalesce((select pg_catalog.string_agg(e.s, ',' order by e.s collate "C")
                                   from (select a.attname::text || ':' || case when x.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee)::text end || '/' || x.privilege_type || case when x.is_grantable then '*' else '' end as s
                                           from pg_catalog.pg_attribute a, pg_catalog.aclexplode(a.attacl) x
                                          where a.attrelid = t.o and a.attnum > 0 and not a.attisdropped
                                            and (x.grantee = 0 or x.grantee = 'zell_catalog_definer'::regrole)) e), ''),
       ' | ' order by t.n collate "C")
     from (values ('product_images'::text, 'public.product_images'::regclass::oid),
                  ('products'::text, 'public.products'::regclass::oid),
                  ('storage_orphans'::text, 'public.storage_orphans'::regclass::oid)) t(n, o));
  if v_g is distinct from 'product_images:REL=zell_catalog_definer/DELETE;COL=bucket:zell_catalog_definer/SELECT,fit:zell_catalog_definer/UPDATE,id:zell_catalog_definer/SELECT,is_primary:zell_catalog_definer/SELECT,is_primary:zell_catalog_definer/UPDATE,kind:zell_catalog_definer/SELECT,object_path:zell_catalog_definer/SELECT,product_id:zell_catalog_definer/SELECT,sort_order:zell_catalog_definer/SELECT,updated_at:zell_catalog_definer/UPDATE | products:REL=zell_catalog_definer/DELETE;COL=id:zell_catalog_definer/SELECT,is_active:zell_catalog_definer/SELECT,updated_at:zell_catalog_definer/SELECT,updated_at:zell_catalog_definer/UPDATE | storage_orphans:REL=;COL=bucket:zell_catalog_definer/INSERT,bucket:zell_catalog_definer/SELECT,cleaned_at:zell_catalog_definer/SELECT,cleaned_at:zell_catalog_definer/UPDATE,id:zell_catalog_definer/SELECT,object_path:zell_catalog_definer/INSERT,object_path:zell_catalog_definer/SELECT,reason:zell_catalog_definer/INSERT' then
    v_bad := v_bad || ('acl: ' || coalesce(v_g, '(null)'));
  end if;
  v_r := (select 'super=' || r.rolsuper::text || ' inherit=' || r.rolinherit::text || ' createrole=' || r.rolcreaterole::text
         || ' createdb=' || r.rolcreatedb::text || ' login=' || r.rolcanlogin::text || ' replication=' || r.rolreplication::text
         || ' bypassrls=' || r.rolbypassrls::text
         || ' memberof=' || coalesce((select pg_catalog.string_agg(g.rolname::text, ',' order by g.rolname::text collate "C")
                                        from pg_catalog.pg_auth_members m join pg_catalog.pg_roles g on g.oid = m.roleid
                                       where m.member = r.oid), '')
         || ' members=' || coalesce((select pg_catalog.string_agg(y.s, ';' order by y.s collate "C")
                                       from (select mm.rolname::text || ':inherit=' || pg_catalog.bool_or(m.inherit_option)::text
                                                    || ',set=' || pg_catalog.bool_or(m.set_option)::text as s
                                               from pg_catalog.pg_auth_members m join pg_catalog.pg_roles mm on mm.oid = m.member
                                              where m.roleid = r.oid group by mm.rolname) y), '')
         || ' schema_usage=' || pg_catalog.has_schema_privilege(r.oid, 'public', 'USAGE')::text
         || ' schema_create=' || pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE')::text
     from pg_catalog.pg_roles r where r.rolname = 'zell_catalog_definer');
  if v_r is distinct from 'super=false inherit=false createrole=false createdb=false login=false replication=false bypassrls=false memberof= members=postgres:inherit=false,set=true schema_usage=true schema_create=false' then
    v_bad := v_bad || ('role: ' || coalesce(v_r, '(null)'));
  end if;
  v_p := (select pg_catalog.string_agg(p.tablename::text || '.' || p.policyname::text || ':' || p.cmd || ':' || p.permissive || ':'
         || pg_catalog.array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'),
       ' | ' order by p.tablename::text collate "C", p.policyname::text collate "C")
     from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename in ('product_images', 'products', 'storage_orphans')
      and p.roles && array['zell_catalog_definer', 'public']::name[]);
  if v_p is distinct from 'product_images.zell_catalog_definer_image_delete:DELETE:PERMISSIVE:zell_catalog_definer:true:- | product_images.zell_catalog_definer_image_promote:UPDATE:PERMISSIVE:zell_catalog_definer:true:(is_primary AND (fit = ''cover''::text) AND (kind = ''gallery''::text)) | product_images.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | product_images.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_delete:DELETE:PERMISSIVE:zell_catalog_definer:true:- | products.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | products.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:- | storage_orphans.zell_catalog_definer_insert:INSERT:PERMISSIVE:zell_catalog_definer:-:((reason = ''product_deleted''::text) AND (cleaned_at IS NULL)) | storage_orphans.zell_catalog_definer_insert_removed:INSERT:PERMISSIVE:zell_catalog_definer:-:((reason = ''removed''::text) AND (cleaned_at IS NULL)) | storage_orphans.zell_catalog_definer_lock:UPDATE:PERMISSIVE:zell_catalog_definer:true:false | storage_orphans.zell_catalog_definer_select:SELECT:PERMISSIVE:zell_catalog_definer:true:-' then
    v_bad := v_bad || ('policies: ' || coalesce(v_p, '(null)'));
  end if;
  if (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
       where c.conrelid = 'public.storage_orphans'::regclass and c.conname = 'storage_orphans_reason_check')
     is distinct from 'CHECK ((reason = ANY (ARRAY[''insert_failed''::text, ''delete_failed''::text, ''replaced''::text, ''removed''::text, ''product_deleted''::text])))' then
    v_bad := v_bad || 'orphan_reason_check'::text;
  end if;
  if pg_catalog.cardinality(v_bad) > 0 then
    raise exception 'ZELL_0026_POST_SHAPE' using detail = pg_catalog.array_to_string(v_bad, ' ; ');
  end if;
end
$idpost$;
-- <<< 0026 BODY

create temporary table zt_results (n serial, id text, outcome text, detail text) on commit drop;

do $zchk$
declare
  v_del oid := pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)');
  v_trg oid := pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()');
  v_ok boolean;
  v_state text := '';
begin
  v_ok := v_del is not null and v_trg is not null
    and not exists (select 1 from pg_catalog.pg_proc p where p.oid in (v_del, v_trg)
                     and (pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_catalog_definer' or not p.prosecdef));
  insert into pg_temp.zt_results (id, outcome, detail) values ('T01', case when v_ok then 'pass' else 'fail' end,
    'functions owned by zell_catalog_definer, security definer');

  v_ok := pg_catalog.has_function_privilege('authenticated', v_del, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', v_del, 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', v_del, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', v_trg, 'EXECUTE');
  insert into pg_temp.zt_results (id, outcome, detail) values ('T02', case when v_ok then 'pass' else 'fail' end,
    'EXECUTE: authenticated on the delete function only');

  v_ok := exists (select 1 from pg_catalog.pg_trigger t
                   where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard'
                     and t.tgenabled = 'O' and t.tgfoid = v_trg);
  insert into pg_temp.zt_results (id, outcome, detail) values ('T03', case when v_ok then 'pass' else 'fail' end,
    'activation guard trigger on products, enabled');

  v_ok := (select pg_catalog.count(*) from pg_catalog.pg_policies p
            where p.schemaname = 'public'
              and p.policyname in ('zell_catalog_definer_image_delete', 'zell_catalog_definer_image_promote',
                                   'zell_catalog_definer_insert_removed')) = 3;
  insert into pg_temp.zt_results (id, outcome, detail) values ('T04', case when v_ok then 'pass' else 'fail' end,
    'three new policies present');

  v_ok := pg_catalog.current_setting('zell.pt0026_fp', true) = pg_catalog.md5(pg_catalog.concat_ws('|',
      (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, ',' order by t.id), '')) from public.product_images t),
      (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, ',' order by t.id), '')) from public.storage_orphans t),
      (select pg_catalog.md5(coalesce(pg_catalog.string_agg(t.id::text || ':' || t.is_active::text, ',' order by t.id), '')) from public.products t)));
  insert into pg_temp.zt_results (id, outcome, detail) values ('T05', case when v_ok then 'pass' else 'fail' end,
    'product_images, storage_orphans and product visibility unchanged by the body');

  begin
    perform pg_catalog.set_config('request.jwt.claims', '', true);
    execute 'set local role authenticated';
    perform public.zell_product_image_delete(0, 0);
    execute 'reset role';
    v_state := 'no error';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  insert into pg_temp.zt_results (id, outcome, detail) values ('T06', case when v_state = '45400' then 'pass' else 'fail' end,
    'call without a session -> 45400 before any write (got ' || v_state || ')');
end
$zchk$;

select s.n, s.id, s.outcome, s.detail
  from (select 0 as n, 'summary'::text as id,
               case when pg_catalog.count(*) filter (where r.outcome = 'fail') = 0 and pg_catalog.count(*) = 6 then 'PASS' else 'FAIL' end as outcome,
               'pass=' || pg_catalog.count(*) filter (where r.outcome = 'pass') || ' fail=' || pg_catalog.count(*) filter (where r.outcome = 'fail') as detail
          from pg_temp.zt_results r
        union all
        select r.n, r.id, r.outcome, r.detail from pg_temp.zt_results r) s
 order by s.n;
rollback;
