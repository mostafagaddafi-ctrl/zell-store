-- 0026 IMAGE-DELETE — حذف صورة واحدة من منتج + حارس تفعيل المنتج (SQL بس)
--
-- العقد: docs/contracts/IMAGE-DELETE.md (مقبول على 59f755c، #222).
--   • zell_product_image_delete(integer, bigint) — المالك بس، EXECUTE لـ authenticated. الأكواد 45701..45704.
--   • zell_catalog_trg_products_activation_guard() + trigger zell_catalog_products_activation_guard على products — الكود 45705.
--   • مالكهم الدور الموجود zell_catalog_definer (0022)، بمنح زيادة على product_images بس وثلاث policies جديدة.
--   • مفيش تعديل في أي دالة موجودة ولا أي قيد. storage_orphans_reason_check زي ما هو (السبب removed موجود من 0012).
--   • مفيش مسح من Storage.
-- الرجوع: 0026_image_delete_rollback.sql · التحقق: 0026_image_delete_verify.sql · الاختبار قبل التطبيق: 0026_image_delete_ptest.sql ·
-- الأثر: 0026_image_delete_impact.sql · CI: backend/db/ci/0026_sql_ci.sh + backend/db/ci/0026_flows.sql
-- التشغيل: سطر الموافقة بعد begin; (برّه الجسم):  set local zell.approved_by = 'owner-approval-YYYY-MM-DD-0026-image-delete';
-- ⚠ بيتطبّق على Production بموافقة صريحة بس، قبل نشر كود اللوحة (C1).

begin;
-- >>> 0026 BODY
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- (0) preflight: المتصل · الموافقة · المتطلبات (دور 0022 ومنحه) · مش متطبّق قبل كده · الأكواد 45701..45705 مش مستخدمة · قيد الأسباب.
do $idpre$
declare
  v_by text := pg_catalog.btrim(coalesce(pg_catalog.current_setting('zell.approved_by', true), ''));
  v_con text;
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
     or not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.products', 'is_active', 'SELECT')
     or not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.products', 'updated_at', 'UPDATE')
     or not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.storage_orphans', 'cleaned_at', 'UPDATE')
     or not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.storage_orphans', 'reason', 'INSERT')
     or not exists (select 1 from pg_catalog.pg_policies p
                     where p.schemaname = 'public' and p.tablename = 'products' and p.policyname = 'zell_catalog_definer_lock')
     or not exists (select 1 from pg_catalog.pg_policies p
                     where p.schemaname = 'public' and p.tablename = 'storage_orphans' and p.policyname = 'zell_catalog_definer_lock')
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
                                        'zell_catalog_definer_insert_removed'))
     or pg_catalog.has_table_privilege('zell_catalog_definer', 'public.product_images', 'DELETE')
     or pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'kind', 'SELECT')
     or pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'is_primary', 'UPDATE') then
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
end
$idpre$;

-- (1) أقل صلاحيات زيادة (العقد §٤): على product_images بس، وpolicies جديدة باسم zell_catalog_definer_*.
--     قفل صف المنتج (for share) وسجل الملف (for update) بيستخدموا منح وpolicies 0022 الموجودة (update بـ with check (false)).
--     الترقية: policy update شرطها النتيجة رئيسية cover من المعرض بس. التسجيل: سبب removed بس.
grant select (kind, is_primary, sort_order), update (is_primary, fit, updated_at), delete
  on table public.product_images to zell_catalog_definer;
create policy zell_catalog_definer_image_delete on public.product_images
  for delete to zell_catalog_definer using (true);
create policy zell_catalog_definer_image_promote on public.product_images
  for update to zell_catalog_definer using (true) with check (is_primary and fit = 'cover' and kind = 'gallery');
create policy zell_catalog_definer_insert_removed on public.storage_orphans
  for insert to zell_catalog_definer with check (reason = 'removed' and cleaned_at is null);

-- (2) الدالتين، مالكهم zell_catalog_definer (CREATE على السكيما مؤقت حوالين الإنشاء بس، زي 0023).
grant create on schema public to zell_catalog_definer;
set local role zell_catalog_definer;

-- حذف صورة واحدة (العقد §٢–§٥): المالك بس · المنتج for share ← صوره for update ← سجل الملف nowait ← القرار بعد الأقفال.
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
  v_cleaned boolean;
  v_has_orphan boolean := false;
  v_recorded boolean := false;
  v_deleted integer := 0;
  v_promoted bigint;
begin
  if p_product_id is null or p_image_id is null then
    raise exception 'ZELL_IMAGE_NOT_FOUND' using errcode = '45701';
  end if;

  -- (1) صف المنتج for share: بيمنع التفعيل (وأي تعديل على الصف) لحد الـ commit.
  begin
    select p.id into v_pid from public.products p where p.id = p_product_id for share;
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
  if not v_has_orphan then
    begin
      insert into public.storage_orphans (bucket, object_path, reason) values (v_bucket, v_path, 'removed');
      v_recorded := true;
    exception when unique_violation then
      raise exception 'ZELL_IMAGE_BUSY' using errcode = '45704', detail = 'orphan_insert';
    end;
  end if;

  -- (7) مسح الصف.
  delete from public.product_images i where i.id = p_image_id and i.product_id = p_product_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
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
       where i.id = v_promoted;
    end if;
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

-- (4) postflight: المالك · security definer · الإعدادات · الصلاحيات بالظبط (من غير grant option) · الـ trigger · الـ policies · المنح.
do $idpost$
declare
  v_del oid := pg_catalog.to_regprocedure('public.zell_product_image_delete(integer, bigint)');
  v_trg oid := pg_catalog.to_regprocedure('public.zell_catalog_trg_products_activation_guard()');
  v_att smallint := (select a.attnum from pg_catalog.pg_attribute a
                      where a.attrelid = 'public.products'::regclass and a.attname = 'is_active');
begin
  if v_del is null or v_trg is null
     or exists (select 1 from pg_catalog.pg_proc p where p.oid in (v_del, v_trg)
                   and (pg_catalog.pg_get_userbyid(p.proowner) <> 'zell_catalog_definer' or not p.prosecdef))
     or (select p.proconfig from pg_catalog.pg_proc p where p.oid = v_del) is distinct from array['search_path=""', 'lock_timeout=3s']
     or (select p.proconfig from pg_catalog.pg_proc p where p.oid = v_trg) is distinct from array['search_path=""']
     or not pg_catalog.has_function_privilege('authenticated', v_del, 'EXECUTE')
     or exists (select 1 from (values ('anon'), ('service_role')) r(n) where pg_catalog.has_function_privilege(r.n, v_del, 'EXECUTE'))
     or exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(n) where pg_catalog.has_function_privilege(r.n, v_trg, 'EXECUTE'))
     or exists (select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                 where p.oid in (v_del, v_trg) and (a.grantee = 0 or a.is_grantable))
     or (select pg_catalog.count(*) from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
          where p.oid = v_del and a.grantee <> p.proowner) <> 1
     or (select pg_catalog.count(*) from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
          where p.oid = v_trg and a.grantee <> p.proowner) <> 0
     or not exists (select 1 from pg_catalog.pg_trigger t
                     where t.tgrelid = 'public.products'::regclass and t.tgname = 'zell_catalog_products_activation_guard'
                       and t.tgenabled = 'O' and t.tgfoid = v_trg and t.tgtype = 23
                       and t.tgattr::smallint[] = array[v_att])
     or (select pg_catalog.count(*) from pg_catalog.pg_policies p
          where p.schemaname = 'public' and p.roles = array['zell_catalog_definer']::name[]
            and ((p.tablename = 'product_images' and p.policyname = 'zell_catalog_definer_image_delete'
                  and p.cmd = 'DELETE' and p.qual = 'true' and p.with_check is null)
              or (p.tablename = 'product_images' and p.policyname = 'zell_catalog_definer_image_promote'
                  and p.cmd = 'UPDATE' and p.qual = 'true' and p.with_check like '%is_primary%'
                  and p.with_check like '%cover%' and p.with_check like '%gallery%')
              or (p.tablename = 'storage_orphans' and p.policyname = 'zell_catalog_definer_insert_removed'
                  and p.cmd = 'INSERT' and p.qual is null and p.with_check like '%removed%'
                  and p.with_check like '%cleaned_at IS NULL%'))) <> 3
     or not pg_catalog.has_table_privilege('zell_catalog_definer', 'public.product_images', 'DELETE')
     or exists (select 1 from (values ('kind'), ('is_primary'), ('sort_order')) c(n)
                 where not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', c.n, 'SELECT'))
     or exists (select 1 from (values ('is_primary'), ('fit'), ('updated_at')) c(n)
                 where not pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', c.n, 'UPDATE'))
     or pg_catalog.has_column_privilege('zell_catalog_definer', 'public.product_images', 'kind', 'UPDATE')
     or pg_catalog.has_table_privilege('zell_catalog_definer', 'public.product_images', 'INSERT')
     or pg_catalog.has_schema_privilege('zell_catalog_definer', 'public', 'CREATE')
     or (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
          where c.conrelid = 'public.storage_orphans'::regclass and c.conname = 'storage_orphans_reason_check')
        is distinct from 'CHECK ((reason = ANY (ARRAY[''insert_failed''::text, ''delete_failed''::text, ''replaced''::text, ''removed''::text, ''product_deleted''::text])))' then
    raise exception 'ZELL_0026_POST_SHAPE';
  end if;
end
$idpost$;
-- <<< 0026 BODY
commit;
