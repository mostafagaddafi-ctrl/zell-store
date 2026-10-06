-- 0020 — اختبار قبل التطبيق (pre-apply ptest) لـ 0020_inventory_purchasing.sql
--
-- • قبل التطبيق بس (لو 0020 متطبّق بيقف بـ ZELL_0020_PTEST_PRE_APPLY_ONLY). بعد التطبيق: 0020_inventory_purchasing_verify.sql.
-- • كل حاجة جوه معاملة واحدة بتنتهي بـ ROLLBACK — ومنها الجداول والـsequences الجديدة، فمفيش sequence حي بيتقدم.
-- • جسم الـmigration منسوخ بالحرف بين علامتي >>> و <<< (md5 الجسمين متطابق — موجود في وصف الـPR).
-- • ملفين تشغيل: light (الافتراضي، المقترح لـProduction) و full (2,000 مستند و20,000 lot — بيئة معزولة، أو موافقة صريحة على الحمل).
-- • مفيش أي UPDATE أو INSERT على products / product_widths / admin_users. الـfixtures بتتختار بالخصائص.
-- • النداءات كـ service_role (الـcaller الحقيقي)، والـactor (owner/admin/عشوائي/null) منفصل.
-- • النتيجة بترجع في رسالة ZELL_0020_PTEST_RESULT (الرسالة exception عن قصد، والمعاملة بترجع).
-- • الأثر على Production: SHARE ROW EXCLUSIVE على products لحد آخر المعاملة (ثواني في light)، و FOR SHARE على صفوف
--   fixtures المنتجات أثناء الترحيلات (حفظ المنتج/العروض من اللوحة بيستنى)، وWAL قليل. full ممكن ياخد دقايق ويعدّي حد الـ60 ثانية.
-- ⚠ تشغيله على Production محتاج موافقة منفصلة.

begin;
select pg_catalog.set_config('zell.ptest_profile', 'light', true);   -- 'light' | 'full'

do $zguard$
begin
  if pg_catalog.to_regrole('zell_inventory_definer') is not null or pg_catalog.to_regclass('public.purchase_docs') is not null then
    raise exception 'ZELL_0020_PTEST_PRE_APPLY_ONLY';
  end if;
end
$zguard$;

create temporary table zell_0020_pt_fp_before on commit drop as
select
  (select count(*) from public.orders) as orders_n,
  (select count(*) from public.order_items) as order_items_n,
  (select count(*) from public.products) as products_n,
  (select count(*) from public.product_widths) as product_widths_n,
  (select count(*) from public.product_addons) as product_addons_n,
  (select count(*) from public.coupons) as coupons_n,
  (select count(*) from public.settings) as settings_n,
  (select count(*) from public.admin_users) as admin_users_n,
  (select coalesce(sum(o.total_piastres), 0) from public.orders o) as orders_total,
  (select md5(coalesce(string_agg(p.id || ':' || p.sale_unit || ':' || p.price_per_meter_piastres || ':' || p.width_cm, ',' order by p.id), ''))
     from public.products p) as products_md5,
  (select md5(coalesce(string_agg(s.key || '=' || s.value::text, ',' order by s.key), ''))
     from public.settings s) as settings_md5,
  (select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' order by p.oid::regprocedure::text), ''))
     from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('zell_create_order', 'zell_get_order_receipt', 'zell_preview_coupon',
                        'zell_set_product_widths', 'zell_set_product_addons', 'zell_orders_cancelled_final')) as functions_md5;

-- >>> 0020 BODY
set local lock_timeout = '5s';
set local statement_timeout = '50s';

-- (0) preflight بنيوي (مفيش md5 كشرط — البصمات للمقارنة بس)
do $zpre$
declare
  v_src text;
  v_lock integer;
  v_write integer;
  v_n integer;
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_0020_WRONG_CALLER';
  end if;
  if not (select r.rolcreaterole from pg_catalog.pg_roles r where r.rolname = current_user) then
    raise exception 'ZELL_0020_NO_CREATEROLE';
  end if;
  if pg_catalog.current_setting('server_version_num')::integer < 170000 then
    raise exception 'ZELL_0020_SERVER_VERSION';
  end if;
  if coalesce(pg_catalog.current_setting('createrole_self_grant', true), '') ilike '%inherit%' then
    raise exception 'ZELL_0020_CREATEROLE_SELF_GRANT_UNSUPPORTED';
  end if;
  if pg_catalog.to_regrole('service_role') is null or pg_catalog.to_regrole('authenticator') is null then
    raise exception 'ZELL_0020_CALLER_ROLES_MISSING';
  end if;
  if not pg_catalog.pg_has_role('authenticator', 'service_role', 'MEMBER') then
    raise exception 'ZELL_0020_REST_CALLER_MODEL';
  end if;
  if not pg_catalog.pg_has_role('postgres', 'service_role', 'SET') then
    raise exception 'ZELL_0020_PTEST_CALLER_MODEL';
  end if;

  select count(*) into v_n from pg_catalog.pg_attribute a
   where a.attrelid = 'public.products'::regclass and a.attnum > 0 and not a.attisdropped
     and (a.attname::text, pg_catalog.format_type(a.atttypid, a.atttypmod)) in
         (('id', 'integer'), ('name_ar', 'text'), ('sale_unit', 'text'), ('width_cm', 'integer'), ('is_active', 'boolean'));
  if v_n <> 5 then
    raise exception 'ZELL_0020_PRODUCTS_SHAPE';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint c
                  where c.conrelid = 'public.products'::regclass and c.conname = 'products_sale_unit_check' and c.contype = 'c') then
    raise exception 'ZELL_0020_PRODUCTS_SALE_UNIT_CHECK';
  end if;
  if not exists (select 1 from pg_catalog.pg_index i
                  where i.indrelid = 'public.products'::regclass and i.indisprimary and i.indnatts = 1
                    and i.indkey[0] = (select a.attnum from pg_catalog.pg_attribute a
                                        where a.attrelid = 'public.products'::regclass and a.attname = 'id')) then
    raise exception 'ZELL_0020_PRODUCTS_PK';
  end if;

  select count(*) into v_n from pg_catalog.pg_attribute a
   where a.attrelid = 'public.product_widths'::regclass and a.attnum > 0 and not a.attisdropped
     and (a.attname::text, pg_catalog.format_type(a.atttypid, a.atttypmod)) in
         (('product_id', 'integer'), ('width_cm', 'integer'), ('is_active', 'boolean'));
  if v_n <> 3 then
    raise exception 'ZELL_0020_PRODUCT_WIDTHS_SHAPE';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint c
                  where c.conrelid = 'public.product_widths'::regclass and c.conname = 'product_widths_product_width_key' and c.contype = 'u') then
    raise exception 'ZELL_0020_PRODUCT_WIDTHS_KEY';
  end if;

  select count(*) into v_n from pg_catalog.pg_attribute a
   where a.attrelid = 'public.admin_users'::regclass and a.attnum > 0 and not a.attisdropped
     and (a.attname::text, pg_catalog.format_type(a.atttypid, a.atttypmod)) in
         (('user_id', 'uuid'), ('role', 'text'), ('is_active', 'boolean'));
  if v_n <> 3 then
    raise exception 'ZELL_0020_ADMIN_USERS_SHAPE';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint c
                  where c.conrelid = 'public.admin_users'::regclass and c.conname = 'admin_users_role_check' and c.contype = 'c')
     or not exists (select 1 from pg_catalog.pg_constraint c
                     where c.conrelid = 'public.admin_users'::regclass and c.contype = 'p') then
    raise exception 'ZELL_0020_ADMIN_USERS_CONSTRAINTS';
  end if;
  if not exists (select 1 from public.admin_users u where u.role = 'owner' and u.is_active) then
    raise exception 'ZELL_0020_NO_ACTIVE_OWNER';
  end if;

  select pg_catalog.lower(pg_catalog.regexp_replace(p.prosrc, '\s+', ' ', 'g')) into v_src
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.zell_set_product_widths(integer,jsonb)');
  if v_src is null then
    raise exception 'ZELL_0020_WIDTHS_FUNCTION_MISSING';
  end if;
  v_lock := pg_catalog.regexp_instr(v_src, 'from public\.products\M[^;]*for update');
  v_write := pg_catalog.regexp_instr(v_src, '(delete from|update|insert into) public\.product_widths');
  if v_lock = 0 or v_write = 0 or v_lock > v_write then
    raise exception 'ZELL_0020_WIDTHS_LOCK_CONTRACT_MISSING';
  end if;

  if pg_catalog.to_regrole('zell_inventory_definer') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%')
     or exists (select 1 from pg_catalog.pg_class c
                 where c.relnamespace = 'public'::regnamespace and c.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log', 'purchase_doc_no_seq', 'opening_doc_no_seq', 'roll_lot_seq', 'batch_lot_seq'))
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = 'public.products'::regclass and t.tgname = 'zinv_products_sale_unit') then
    raise exception 'ZELL_0020_ALREADY_APPLIED';
  end if;
end
$zpre$;

-- بصمة قبل (للمقارنة في الـpostflight بس)
create temporary view zell_0020_fp_now as
select
  (select count(*) from public.orders) as orders_n,
  (select count(*) from public.order_items) as order_items_n,
  (select count(*) from public.products) as products_n,
  (select count(*) from public.product_widths) as product_widths_n,
  (select count(*) from public.product_addons) as product_addons_n,
  (select count(*) from public.coupons) as coupons_n,
  (select count(*) from public.settings) as settings_n,
  (select count(*) from public.admin_users) as admin_users_n,
  (select coalesce(sum(o.total_piastres), 0) from public.orders o) as orders_total,
  (select md5(coalesce(string_agg(p.id || ':' || p.sale_unit || ':' || p.price_per_meter_piastres || ':' || p.width_cm, ',' order by p.id), ''))
     from public.products p) as products_md5,
  (select md5(coalesce(string_agg(s.key || '=' || s.value::text, ',' order by s.key), ''))
     from public.settings s) as settings_md5,
  (select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' order by p.oid::regprocedure::text), ''))
     from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('zell_create_order', 'zell_get_order_receipt', 'zell_preview_coupon',
                        'zell_set_product_widths', 'zell_set_product_addons', 'zell_orders_cancelled_final')) as functions_md5;
create temporary table zell_0020_fp_before on commit drop as select * from zell_0020_fp_now;


-- (1) الدور: NOLOGIN + NOBYPASSRLS + NOINHERIT. عضوية postgres: ADMIN (تلقائي من CREATE ROLE) + SET، و INHERIT FALSE.
create role zell_inventory_definer nologin nobypassrls noinherit nocreaterole nocreatedb noreplication;

do $zrole$
begin
  if not exists (select 1 from pg_catalog.pg_auth_members m
                  where m.roleid = 'zell_inventory_definer'::regrole and m.member = 'postgres'::regrole and m.admin_option) then
    raise exception 'ZELL_0020_ROLE_ADMIN_MISSING';
  end if;
end
$zrole$;

grant zell_inventory_definer to postgres with inherit false, set true;

do $zrole2$
begin
  if exists (select 1 from pg_catalog.pg_auth_members m
              where m.roleid = 'zell_inventory_definer'::regrole and m.member = 'postgres'::regrole and m.inherit_option)
     or not exists (select 1 from pg_catalog.pg_auth_members m
                     where m.roleid = 'zell_inventory_definer'::regrole and m.member = 'postgres'::regrole and m.admin_option)
     or not exists (select 1 from pg_catalog.pg_auth_members m
                     where m.roleid = 'zell_inventory_definer'::regrole and m.member = 'postgres'::regrole and m.set_option) then
    raise exception 'ZELL_0020_ROLE_MEMBERSHIP_SHAPE';
  end if;
end
$zrole2$;


-- (2) sequences أرقام المستندات والـlots (الفجوات عادية)
create sequence public.purchase_doc_no_seq as bigint;
create sequence public.opening_doc_no_seq as bigint;
create sequence public.roll_lot_seq as bigint;
create sequence public.batch_lot_seq as bigint;

-- (3) الجداول (الـFKs على products بتتضاف في الآخر — §12.2)
create table public.inventory_locations (
  id          bigint      generated always as identity primary key,
  code        text        not null,
  name        text        not null,
  is_default  boolean     not null default false,
  is_active   boolean     not null default true,
  created_by  uuid,
  updated_by  uuid,
  version     integer     not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint inventory_locations_code_key unique (code),
  constraint inventory_locations_code_shape check (code ~ '^[A-Z0-9_-]{2,20}$'),
  constraint inventory_locations_name_len check (char_length(name) between 1 and 80),
  constraint inventory_locations_default_active check (not (is_default and not is_active)),
  constraint inventory_locations_version check (version >= 1)
);
create unique index inventory_locations_one_default on public.inventory_locations (is_default) where is_default;
create index inventory_locations_active_id on public.inventory_locations (is_active, id);

create table public.suppliers (
  id          bigint      generated always as identity primary key,
  name        text        not null,
  name_key    text        not null,
  phone       text,
  note        text,
  is_active   boolean     not null default true,
  created_by  uuid        not null,
  updated_by  uuid        not null,
  version     integer     not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint suppliers_name_key_key unique (name_key),
  constraint suppliers_name_len check (char_length(name) between 1 and 120),
  constraint suppliers_name_key_len check (char_length(name_key) between 1 and 120),
  constraint suppliers_phone_shape check (phone is null or phone ~ '^\+?[0-9]{6,15}$'),
  constraint suppliers_note_len check (note is null or char_length(note) <= 500),
  constraint suppliers_version check (version >= 1)
);
create index suppliers_active_name_key on public.suppliers (name_key) where is_active;

create table public.purchase_docs (
  id                          bigint      generated always as identity primary key,
  doc_no                      text        not null,
  status                      text        not null default 'draft',
  supplier_id                 bigint      references public.suppliers (id) on delete restrict,
  supplier_ref                text,
  location_id                 bigint      not null references public.inventory_locations (id) on delete restrict,
  doc_date                    date        not null,
  note                        text,
  draft_payload               jsonb,
  supplier_discount_piastres  bigint      not null default 0,
  items_subtotal_piastres     bigint      not null default 0,
  extras_total_piastres       bigint      not null default 0,
  total_cost_piastres         bigint      not null default 0,
  line_count                  integer     not null default 0,
  charge_count                integer     not null default 0,
  lot_count                   integer     not null default 0,
  supplier_name_snapshot      text,
  location_name_snapshot      text,
  posted_at                   timestamptz,
  posted_by                   uuid,
  voided_at                   timestamptz,
  voided_by                   uuid,
  void_reason                 text,
  discarded_at                timestamptz,
  discarded_by                uuid,
  discard_reason              text,
  created_by                  uuid        not null,
  updated_by                  uuid        not null,
  version                     integer     not null default 1,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint purchase_docs_doc_no_key unique (doc_no),
  constraint purchase_docs_doc_no_shape check (doc_no ~ '^PUR-[0-9]{6,}$'),
  constraint purchase_docs_status check (status in ('draft', 'posted', 'voided', 'discarded')),
  constraint purchase_docs_supplier_ref_len check (supplier_ref is null or char_length(supplier_ref) <= 60),
  constraint purchase_docs_note_len check (note is null or char_length(note) <= 500),
  constraint purchase_docs_void_reason_len check (void_reason is null or char_length(void_reason) between 3 and 300),
  constraint purchase_docs_discard_reason_len check (discard_reason is null or char_length(discard_reason) <= 300),
  constraint purchase_docs_amount_ranges check (
    supplier_discount_piastres between 0 and 10000000000
    and items_subtotal_piastres between 0 and 1000000000000
    and extras_total_piastres between 0 and 500000000000
  ),
  constraint purchase_docs_count_ranges check (
    line_count between 0 and 100 and charge_count between 0 and 50 and lot_count between 0 and 200
  ),
  constraint purchase_docs_total_eq check (
    total_cost_piastres = items_subtotal_piastres + extras_total_piastres - supplier_discount_piastres
  ),
  constraint purchase_docs_payload_by_status check (
    (status in ('draft', 'discarded') and draft_payload is not null)
    or (status in ('posted', 'voided') and draft_payload is null)
  ),
  constraint purchase_docs_snapshots check (
    (status in ('posted', 'voided') and location_name_snapshot is not null
       and (supplier_id is null) = (supplier_name_snapshot is null))
    or (status in ('draft', 'discarded') and location_name_snapshot is null and supplier_name_snapshot is null)
  ),
  constraint purchase_docs_posted_shape check (
    status not in ('posted', 'voided')
    or (line_count between 1 and 100 and lot_count between 1 and 200 and charge_count between 0 and 50
        and (supplier_discount_piastres = 0 or supplier_discount_piastres < items_subtotal_piastres))
  ),
  constraint purchase_docs_draft_lots check (status <> 'draft' or lot_count = 0),
  constraint purchase_docs_status_stamps check (
    (status = 'draft' and posted_at is null and posted_by is null and voided_at is null and voided_by is null
       and void_reason is null and discarded_at is null and discarded_by is null and discard_reason is null)
    or (status = 'posted' and posted_at is not null and posted_by is not null and voided_at is null and voided_by is null
       and void_reason is null and discarded_at is null and discarded_by is null and discard_reason is null)
    or (status = 'voided' and posted_at is not null and posted_by is not null and voided_at is not null and voided_by is not null
       and void_reason is not null and discarded_at is null and discarded_by is null and discard_reason is null)
    or (status = 'discarded' and posted_at is null and posted_by is null and voided_at is null and voided_by is null
       and void_reason is null and discarded_at is not null and discarded_by is not null)
  ),
  constraint purchase_docs_version check (version >= 1)
);
create index purchase_docs_status_id on public.purchase_docs (status, id desc);
create index purchase_docs_supplier_id on public.purchase_docs (supplier_id, id desc) where supplier_id is not null;
create index purchase_docs_supplier_status_id on public.purchase_docs (supplier_id, status, id desc) where supplier_id is not null;
create index purchase_docs_location on public.purchase_docs (location_id);

create table public.purchase_doc_lines (
  id                     bigint      generated always as identity primary key,
  line_no                integer     not null,
  line_kind              text        not null,
  product_id             integer     not null,
  product_name_snapshot  text        not null,
  sale_unit_snapshot     text        not null,
  width_cm_snapshot      integer,
  roll_count             integer,
  total_length_cm        integer,
  quantity               integer,
  line_total_piastres    bigint      not null,
  zero_cost_reason       text,
  doc_id                       bigint      not null references public.purchase_docs (id) on delete restrict,
  allocated_extras_piastres    bigint      not null,
  allocated_discount_piastres  bigint      not null,
  landed_total_piastres        bigint      not null,
  created_at                   timestamptz not null default now(),
  constraint purchase_doc_lines_doc_line_key unique (doc_id, line_no),
  constraint purchase_doc_lines_line_no check (line_no between 1 and 100),
  constraint purchase_doc_lines_kind check (line_kind in ('roll', 'batch')),
  constraint purchase_doc_lines_unit check (sale_unit_snapshot in ('meter', 'piece')),
  constraint purchase_doc_lines_kind_unit check ((line_kind = 'roll') = (sale_unit_snapshot = 'meter')),
  constraint purchase_doc_lines_kind_shape check (
    (line_kind = 'roll' and width_cm_snapshot between 1 and 1000 and roll_count between 1 and 200
       and total_length_cm between 1 and 20000000 and quantity is null)
    or (line_kind = 'batch' and width_cm_snapshot is null and roll_count is null and total_length_cm is null
       and quantity between 1 and 1000000)
  ),
  constraint purchase_doc_lines_name_len check (char_length(product_name_snapshot) between 1 and 200),
  constraint purchase_doc_lines_total_range check (line_total_piastres between 0 and 10000000000),
  constraint purchase_doc_lines_zero_reason_len check (zero_cost_reason is null or char_length(zero_cost_reason) between 3 and 200),
  constraint purchase_doc_lines_zero_reason check ((line_total_piastres = 0) = (zero_cost_reason is not null)),
  constraint purchase_doc_lines_alloc_nonneg check (allocated_extras_piastres >= 0 and allocated_discount_piastres >= 0),
  constraint purchase_doc_lines_landed_eq check (
    landed_total_piastres = line_total_piastres + allocated_extras_piastres - allocated_discount_piastres
  ),
  constraint purchase_doc_lines_landed_nonneg check (landed_total_piastres >= 0)
);
create index purchase_doc_lines_product on public.purchase_doc_lines (product_id);

create table public.purchase_doc_charges (
  id               bigint      generated always as identity primary key,
  doc_id           bigint      not null references public.purchase_docs (id) on delete restrict,
  charge_no        integer     not null,
  charge_kind      text        not null,
  amount_piastres  bigint      not null,
  reference        text,
  note             text,
  created_at       timestamptz not null default now(),
  constraint purchase_doc_charges_doc_charge_key unique (doc_id, charge_no),
  constraint purchase_doc_charges_no check (charge_no between 1 and 50),
  constraint purchase_doc_charges_kind check (charge_kind in ('transport', 'loading', 'customs', 'other')),
  constraint purchase_doc_charges_amount check (amount_piastres between 1 and 10000000000),
  constraint purchase_doc_charges_reference_len check (reference is null or char_length(reference) <= 60),
  constraint purchase_doc_charges_note_len check (note is null or char_length(note) between 3 and 200),
  constraint purchase_doc_charges_other_note check (charge_kind <> 'other' or note is not null)
);

create table public.opening_stock_docs (
  id                        bigint      generated always as identity primary key,
  doc_no                    text        not null,
  status                    text        not null default 'draft',
  location_id               bigint      not null references public.inventory_locations (id) on delete restrict,
  as_of_date                date        not null,
  note                      text,
  draft_payload             jsonb,
  items_total_piastres      bigint      not null default 0,
  estimated_total_piastres  bigint      not null default 0,
  line_count                integer     not null default 0,
  lot_count                 integer     not null default 0,
  location_name_snapshot    text,
  posted_at                 timestamptz,
  posted_by                 uuid,
  voided_at                 timestamptz,
  voided_by                 uuid,
  void_reason               text,
  discarded_at              timestamptz,
  discarded_by              uuid,
  discard_reason            text,
  created_by                uuid        not null,
  updated_by                uuid        not null,
  version                   integer     not null default 1,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint opening_stock_docs_doc_no_key unique (doc_no),
  constraint opening_stock_docs_doc_no_shape check (doc_no ~ '^OPN-[0-9]{6,}$'),
  constraint opening_stock_docs_status check (status in ('draft', 'posted', 'voided', 'discarded')),
  constraint opening_stock_docs_note_len check (note is null or char_length(note) <= 500),
  constraint opening_stock_docs_void_reason_len check (void_reason is null or char_length(void_reason) between 3 and 300),
  constraint opening_stock_docs_discard_reason_len check (discard_reason is null or char_length(discard_reason) <= 300),
  constraint opening_stock_docs_amount_ranges check (
    items_total_piastres between 0 and 1000000000000
    and estimated_total_piastres between 0 and items_total_piastres
  ),
  constraint opening_stock_docs_count_ranges check (line_count between 0 and 100 and lot_count between 0 and 200),
  constraint opening_stock_docs_payload_by_status check (
    (status in ('draft', 'discarded') and draft_payload is not null)
    or (status in ('posted', 'voided') and draft_payload is null)
  ),
  constraint opening_stock_docs_snapshots check (
    (status in ('posted', 'voided') and location_name_snapshot is not null)
    or (status in ('draft', 'discarded') and location_name_snapshot is null)
  ),
  constraint opening_stock_docs_posted_shape check (
    status not in ('posted', 'voided') or (line_count between 1 and 100 and lot_count between 1 and 200)
  ),
  constraint opening_stock_docs_draft_lots check (status <> 'draft' or lot_count = 0),
  constraint opening_stock_docs_status_stamps check (
    (status = 'draft' and posted_at is null and posted_by is null and voided_at is null and voided_by is null
       and void_reason is null and discarded_at is null and discarded_by is null and discard_reason is null)
    or (status = 'posted' and posted_at is not null and posted_by is not null and voided_at is null and voided_by is null
       and void_reason is null and discarded_at is null and discarded_by is null and discard_reason is null)
    or (status = 'voided' and posted_at is not null and posted_by is not null and voided_at is not null and voided_by is not null
       and void_reason is not null and discarded_at is null and discarded_by is null and discard_reason is null)
    or (status = 'discarded' and posted_at is null and posted_by is null and voided_at is null and voided_by is null
       and void_reason is null and discarded_at is not null and discarded_by is not null)
  ),
  constraint opening_stock_docs_version check (version >= 1)
);
create index opening_stock_docs_status_id on public.opening_stock_docs (status, id desc);
create index opening_stock_docs_location on public.opening_stock_docs (location_id);

create table public.opening_stock_lines (
  id                     bigint      generated always as identity primary key,
  line_no                integer     not null,
  line_kind              text        not null,
  product_id             integer     not null,
  product_name_snapshot  text        not null,
  sale_unit_snapshot     text        not null,
  width_cm_snapshot      integer,
  roll_count             integer,
  total_length_cm        integer,
  quantity               integer,
  line_total_piastres    bigint      not null,
  zero_cost_reason       text,
  doc_id             bigint      not null references public.opening_stock_docs (id) on delete restrict,
  cost_is_estimated  boolean     not null,
  estimate_note      text,
  created_at         timestamptz not null default now(),
  constraint opening_stock_lines_doc_line_key unique (doc_id, line_no),
  constraint opening_stock_lines_line_no check (line_no between 1 and 100),
  constraint opening_stock_lines_kind check (line_kind in ('roll', 'batch')),
  constraint opening_stock_lines_unit check (sale_unit_snapshot in ('meter', 'piece')),
  constraint opening_stock_lines_kind_unit check ((line_kind = 'roll') = (sale_unit_snapshot = 'meter')),
  constraint opening_stock_lines_kind_shape check (
    (line_kind = 'roll' and width_cm_snapshot between 1 and 1000 and roll_count between 1 and 200
       and total_length_cm between 1 and 20000000 and quantity is null)
    or (line_kind = 'batch' and width_cm_snapshot is null and roll_count is null and total_length_cm is null
       and quantity between 1 and 1000000)
  ),
  constraint opening_stock_lines_name_len check (char_length(product_name_snapshot) between 1 and 200),
  constraint opening_stock_lines_total_range check (line_total_piastres between 0 and 10000000000),
  constraint opening_stock_lines_zero_reason_len check (zero_cost_reason is null or char_length(zero_cost_reason) between 3 and 200),
  constraint opening_stock_lines_estimate_note check (cost_is_estimated = (estimate_note is not null)),
  constraint opening_stock_lines_estimate_note_len check (estimate_note is null or char_length(estimate_note) between 3 and 200),
  constraint opening_stock_lines_zero check (
    (line_total_piastres = 0 and zero_cost_reason is not null and not cost_is_estimated)
    or (line_total_piastres > 0 and zero_cost_reason is null)
  )
);
create index opening_stock_lines_product on public.opening_stock_lines (product_id);

create table public.stock_lots (
  id                           bigint      generated always as identity primary key,
  lot_code                     text        not null,
  source_kind                  text        not null,
  purchase_line_id             bigint      references public.purchase_doc_lines (id) on delete restrict,
  opening_line_id              bigint      references public.opening_stock_lines (id) on delete restrict,
  lot_sequence                 integer     not null,
  lot_kind                     text        not null,
  product_id                   integer     not null,
  location_id                  bigint      not null references public.inventory_locations (id) on delete restrict,
  width_cm_snapshot            integer,
  initial_length_cm            integer,
  initial_quantity             integer,
  base_cost_piastres           bigint      not null,
  allocated_extras_piastres    bigint      not null default 0,
  allocated_discount_piastres  bigint      not null default 0,
  landed_cost_piastres         bigint      not null,
  cost_is_estimated            boolean     not null,
  received_on                  date        not null,
  status                       text        not null default 'active',
  voided_at                    timestamptz,
  voided_by                    uuid,
  created_at                   timestamptz not null default now(),
  constraint stock_lots_lot_code_key unique (lot_code),
  constraint stock_lots_lot_code_shape check (
    (lot_kind = 'roll' and lot_code ~ '^R-[0-9]{6,}$') or (lot_kind = 'batch' and lot_code ~ '^B-[0-9]{6,}$')
  ),
  constraint stock_lots_source_kind check (source_kind in ('purchase', 'opening')),
  constraint stock_lots_source_xor check (
    (source_kind = 'purchase' and purchase_line_id is not null and opening_line_id is null)
    or (source_kind = 'opening' and opening_line_id is not null and purchase_line_id is null)
  ),
  constraint stock_lots_lot_sequence check (lot_sequence between 1 and 200),
  constraint stock_lots_kind check (lot_kind in ('roll', 'batch')),
  constraint stock_lots_kind_shape check (
    (lot_kind = 'roll' and width_cm_snapshot between 1 and 1000 and initial_length_cm between 1 and 100000
       and initial_quantity is null)
    or (lot_kind = 'batch' and width_cm_snapshot is null and initial_length_cm is null
       and initial_quantity between 1 and 1000000 and lot_sequence = 1)
  ),
  constraint stock_lots_cost_nonneg check (
    base_cost_piastres >= 0 and allocated_extras_piastres >= 0 and allocated_discount_piastres >= 0
  ),
  constraint stock_lots_landed_eq check (
    landed_cost_piastres = base_cost_piastres + allocated_extras_piastres - allocated_discount_piastres
  ),
  constraint stock_lots_landed_nonneg check (landed_cost_piastres >= 0),
  constraint stock_lots_opening_no_alloc check (
    source_kind <> 'opening' or (allocated_extras_piastres = 0 and allocated_discount_piastres = 0)
  ),
  constraint stock_lots_purchase_not_estimated check (source_kind <> 'purchase' or not cost_is_estimated),
  constraint stock_lots_status check (status in ('active', 'voided')),
  constraint stock_lots_void_stamps check (
    (status = 'active' and voided_at is null and voided_by is null)
    or (status = 'voided' and voided_at is not null and voided_by is not null)
  ),
  constraint stock_lots_purchase_line_seq_key unique (purchase_line_id, lot_sequence),
  constraint stock_lots_opening_line_seq_key unique (opening_line_id, lot_sequence)
);
create index stock_lots_status_id on public.stock_lots (status, id desc);
create index stock_lots_product_status_id on public.stock_lots (product_id, status, id desc);
create index stock_lots_location_status_id on public.stock_lots (location_id, status, id desc);
create index stock_lots_product_location_status_id on public.stock_lots (product_id, location_id, status, id desc);

create table public.inventory_commands (
  command_id     uuid        primary key,
  command_kind   text        not null,
  actor_user_id  uuid        not null,
  request_hash   text        not null,
  target_type    text        not null,
  target_id      bigint      not null,
  result         jsonb       not null,
  created_at     timestamptz not null default now(),
  constraint inventory_commands_kind check (command_kind in (
    'location.create', 'location.update', 'supplier.create', 'supplier.update',
    'purchase.create', 'purchase.update', 'purchase.post', 'purchase.discard', 'purchase.void',
    'opening.create', 'opening.update', 'opening.post', 'opening.discard', 'opening.void')),
  constraint inventory_commands_hash check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint inventory_commands_target_type check (target_type in ('location', 'supplier', 'purchase', 'opening'))
);
create index inventory_commands_actor on public.inventory_commands (actor_user_id, created_at desc);

create table public.inventory_audit_log (
  id             bigint      generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  actor_user_id  uuid        not null,
  command_id     uuid        not null,
  action         text        not null,
  entity_type    text        not null,
  entity_id      bigint      not null,
  version_after  integer     not null,
  "before"       jsonb,
  "after"        jsonb       not null,
  constraint inventory_audit_log_command_fk foreign key (command_id)
    references public.inventory_commands (command_id) deferrable initially deferred,
  constraint inventory_audit_log_action check (action in (
    'location.create', 'location.update', 'supplier.create', 'supplier.update',
    'purchase.create', 'purchase.update', 'purchase.post', 'purchase.discard', 'purchase.void',
    'opening.create', 'opening.update', 'opening.post', 'opening.discard', 'opening.void')),
  constraint inventory_audit_log_entity_type check (entity_type in ('location', 'supplier', 'purchase', 'opening'))
);
create index inventory_audit_log_entity on public.inventory_audit_log (entity_type, entity_id, id);
create index inventory_audit_log_occurred on public.inventory_audit_log (occurred_at desc);
create index inventory_audit_log_command on public.inventory_audit_log (command_id);

-- (4) seed: الموقع الافتراضي (مالوش audit — الـmigration نفسه هو السجل)
insert into public.inventory_locations (code, name, is_default, is_active) values ('MAIN', 'المخزن الرئيسي', true, true);


-- (5) الدوال المساعدة الداخلية (مفيش أي grant لـ service_role / anon / authenticated / PUBLIC)

-- مالكها postgres (definer): قراءة admin_users بس.
create function public.zell_inv_assert_owner(p_actor uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_actor is null
     or not exists (select 1 from public.admin_users a
                     where a.user_id = p_actor and a.role = 'owner' and a.is_active) then
    raise exception 'ZELL_INV_FORBIDDEN' using errcode = '45200';
  end if;
end
$fn$;

-- مالكها postgres (definer): FOR SHARE على صفوف المنتجات (بيتعارض مع FOR UPDATE في zell_set_product_widths — §2.6).
-- product_widths: الـunique (product_id, width_cm) بيحدد صفوف المنتج، وبعدين is_active بيتفلتر.
create function public.zell_inv_lock_products(p_ids integer[])
returns table (product_id integer, name_ar text, sale_unit text, base_width_cm integer, active_widths integer[])
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform 1 from public.products p where p.id = any (p_ids) order by p.id for share;
  return query
    select p.id, p.name_ar, p.sale_unit, p.width_cm,
           coalesce((select array_agg(w.width_cm order by w.width_cm)
                       from public.product_widths w
                      where w.product_id = p.id and w.is_active), '{}'::integer[])
      from public.products p
     where p.id = any (p_ids)
     order by p.id;
end
$fn$;

-- مالكها postgres (definer): نفس القراءة من غير قفل (الحفظ والمعاينة).
create function public.zell_inv_read_products(p_ids integer[])
returns table (product_id integer, name_ar text, sale_unit text, base_width_cm integer, active_widths integer[])
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return query
    select p.id, p.name_ar, p.sale_unit, p.width_cm,
           coalesce((select array_agg(w.width_cm order by w.width_cm)
                       from public.product_widths w
                      where w.product_id = p.id and w.is_active), '{}'::integer[])
      from public.products p
     where p.id = any (p_ids)
     order by p.id;
end
$fn$;

-- مالكها postgres (invoker، مفيش grant): بيناديها trigger sale_unit (definer مملوك لـ postgres) بس.
create function public.zell_inv_product_has_stock_refs(p_product_id integer)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (select 1 from public.purchase_doc_lines l where l.product_id = p_product_id)
      or exists (select 1 from public.opening_stock_lines o where o.product_id = p_product_id)
      or exists (select 1 from public.stock_lots s where s.product_id = p_product_id);
$fn$;

-- الدوال الجاية بتتنقل ملكيتها لـ zell_inventory_definer (§12.2).
create function public.zell_inv_width_allowed(p_base integer, p_active integer[], p_width integer)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_width is not null
     and (p_width = p_base or p_width = any (coalesce(p_active, '{}'::integer[])));
$fn$;

-- largest remainder بأرقام صحيحة بالظبط: q = div(T*w, W) و r = mod(T*w, W)،
-- والقروش الباقية لأكبر r، والتعادل بالترتيب في المصفوفة.
create function public.zell_inv_allocate_lr(p_total bigint, p_weights bigint[])
returns bigint[]
language plpgsql
immutable
parallel safe
set search_path = ''
as $fn$
declare
  v_n integer := coalesce(array_length(p_weights, 1), 0);
  v_sum numeric := 0;
  v_q bigint[] := '{}';
  v_r numeric[] := '{}';
  v_k bigint;
  v_i integer;
  v_idx integer;
begin
  if p_total is null or p_total < 0 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'allocate.total';
  end if;
  for v_i in 1 .. v_n loop
    if p_weights[v_i] is null or p_weights[v_i] < 0 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'allocate.weights';
    end if;
    v_sum := v_sum + p_weights[v_i];
  end loop;
  if p_total = 0 then
    if v_n = 0 then
      return '{}'::bigint[];
    end if;
    return array_fill(0::bigint, array[v_n]);
  end if;
  if v_n = 0 or v_sum = 0 then
    raise exception 'ZELL_INV_ALLOCATION_BASE_ZERO' using errcode = '45210';
  end if;
  for v_i in 1 .. v_n loop
    v_q[v_i] := div(p_total::numeric * p_weights[v_i], v_sum)::bigint;
    v_r[v_i] := mod(p_total::numeric * p_weights[v_i], v_sum);
  end loop;
  v_k := p_total - (select sum(x) from unnest(v_q) as x);
  if v_k > 0 then
    for v_idx in
      select t.ord::integer
        from unnest(v_r) with ordinality as t(rem, ord)
       order by t.rem desc, t.ord asc
       limit v_k
    loop
      v_q[v_idx] := v_q[v_idx] + 1;
    end loop;
  end if;
  return v_q;
end
$fn$;

create function public.zell_inv_normalize_purchase(p_doc jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_tmp jsonb;
  v_key text;
  v_arr jsonb;
  v_item jsonb;
  v_roll jsonb;
  v_i integer;
  v_j integer;
  v_kind text;
  v_supplier_id bigint;
  v_location_id bigint;
  v_date date;
  v_ref text;
  v_note text;
  v_discount bigint;
  v_charges jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_rolls jsonb;
  v_amount bigint;
  v_cref text;
  v_cnote text;
  v_product bigint;
  v_width bigint;
  v_qty bigint;
  v_total bigint;
  v_len bigint;
  v_reason text;
  v_lots integer := 0;
begin
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'doc';
  end if;
  if octet_length(p_doc::text) > 131072 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'doc.size';
  end if;
  for v_key in select jsonb_object_keys(p_doc) loop
    if not (v_key = any (array['supplierId', 'supplierRef', 'locationId', 'docDate', 'note', 'charges', 'supplierDiscountPiastres', 'lines']::text[])) then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'doc.' || left(v_key, 40);
    end if;
  end loop;
  v_tmp := p_doc -> 'supplierId';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    v_supplier_id := null;
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'supplierId';
    end if;
    v_supplier_id := (v_tmp #>> '{}')::bigint;
    if v_supplier_id < 1 or v_supplier_id > 9223372036854775806 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'supplierId';
    end if;
  end if;
  v_tmp := p_doc -> 'supplierRef';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    v_ref := null;
  elsif jsonb_typeof(v_tmp) = 'string' then
    v_ref := nullif(btrim(normalize((v_tmp #>> '{}'), NFC), E' \t\r\n'), '');
  else
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'supplierRef';
  end if;
  if v_ref is null then
    null;
  elsif char_length(v_ref) < 1 or char_length(v_ref) > 60 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'supplierRef';
  end if;
  v_tmp := p_doc -> 'locationId';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'locationId';
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'locationId';
    end if;
    v_location_id := (v_tmp #>> '{}')::bigint;
    if v_location_id < 1 or v_location_id > 9223372036854775806 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'locationId';
    end if;
  end if;
  v_tmp := p_doc -> 'docDate';
  if v_tmp is null or jsonb_typeof(v_tmp) is distinct from 'string'
     or (v_tmp #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docDate';
  end if;
  begin
    v_date := (v_tmp #>> '{}')::date;
  exception when others then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docDate';
  end;
  if to_char(v_date, 'YYYY-MM-DD') <> (v_tmp #>> '{}') then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docDate';
  end if;
  v_tmp := p_doc -> 'note';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    v_note := null;
  elsif jsonb_typeof(v_tmp) = 'string' then
    v_note := nullif(btrim(normalize((v_tmp #>> '{}'), NFC), E' \t\r\n'), '');
  else
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'note';
  end if;
  if v_note is null then
    null;
  elsif char_length(v_note) < 1 or char_length(v_note) > 500 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'note';
  end if;
  v_tmp := p_doc -> 'supplierDiscountPiastres';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    v_discount := 0;
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'supplierDiscountPiastres';
    end if;
    v_discount := (v_tmp #>> '{}')::bigint;
    if v_discount < 0 or v_discount > 10000000000 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'supplierDiscountPiastres';
    end if;
  end if;

  v_arr := p_doc -> 'charges';
  if v_arr is not null and jsonb_typeof(v_arr) <> 'null' then
    if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) > 50 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'charges';
    end if;
    for v_i in 0 .. jsonb_array_length(v_arr) - 1 loop
      v_item := v_arr -> v_i;
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'charges[' || v_i || ']';
      end if;
      for v_key in select jsonb_object_keys(v_item) loop
    if not (v_key = any (array['kind', 'amountPiastres', 'reference', 'note']::text[])) then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'charges[' || v_i || '].' || left(v_key, 40);
    end if;
  end loop;
      v_kind := case when jsonb_typeof(v_item -> 'kind') = 'string' then v_item ->> 'kind' end;
      if v_kind is null or v_kind not in ('transport', 'loading', 'customs', 'other') then
        raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'charges[' || v_i || '].kind';
      end if;
      v_tmp := v_item -> 'amountPiastres';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'charges[' || v_i || '].amountPiastres';
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'charges[' || v_i || '].amountPiastres';
    end if;
    v_amount := (v_tmp #>> '{}')::bigint;
    if v_amount < 1 or v_amount > 10000000000 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'charges[' || v_i || '].amountPiastres';
    end if;
  end if;
      v_tmp := v_item -> 'reference';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    v_cref := null;
  elsif jsonb_typeof(v_tmp) = 'string' then
    v_cref := nullif(btrim(normalize((v_tmp #>> '{}'), NFC), E' \t\r\n'), '');
  else
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'charges[' || v_i || '].reference';
  end if;
  if v_cref is null then
    null;
  elsif char_length(v_cref) < 1 or char_length(v_cref) > 60 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'charges[' || v_i || '].reference';
  end if;
      v_tmp := v_item -> 'note';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    v_cnote := null;
  elsif jsonb_typeof(v_tmp) = 'string' then
    v_cnote := nullif(btrim(normalize((v_tmp #>> '{}'), NFC), E' \t\r\n'), '');
  else
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'charges[' || v_i || '].note';
  end if;
  if v_cnote is null then
    null;
  elsif char_length(v_cnote) < 3 or char_length(v_cnote) > 200 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'charges[' || v_i || '].note';
  end if;
      if v_kind = 'other' and v_cnote is null then
        raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'charges[' || v_i || '].note';
      end if;
      v_charges := v_charges || jsonb_build_array(jsonb_build_object(
        'kind', v_kind, 'amountPiastres', v_amount, 'reference', v_cref, 'note', v_cnote));
    end loop;
  end if;

  v_arr := p_doc -> 'lines';
  if v_arr is not null and jsonb_typeof(v_arr) <> 'null' then
    if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) > 100 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines';
    end if;
    for v_i in 0 .. jsonb_array_length(v_arr) - 1 loop
      v_item := v_arr -> v_i;
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || ']';
      end if;
      v_kind := case when jsonb_typeof(v_item -> 'kind') = 'string' then v_item ->> 'kind' end;
      if v_kind is null or v_kind not in ('roll', 'batch') then
        raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].kind';
      end if;
      if v_kind = 'roll' then
        for v_key in select jsonb_object_keys(v_item) loop
    if not (v_key = any (array['kind', 'productId', 'widthCm', 'rolls', 'lineTotalPiastres', 'zeroCostReason']::text[])) then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].' || left(v_key, 40);
    end if;
  end loop;
      else
        for v_key in select jsonb_object_keys(v_item) loop
    if not (v_key = any (array['kind', 'productId', 'quantity', 'lineTotalPiastres', 'zeroCostReason']::text[])) then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].' || left(v_key, 40);
    end if;
  end loop;
      end if;
      v_tmp := v_item -> 'productId';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].productId';
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].productId';
    end if;
    v_product := (v_tmp #>> '{}')::bigint;
    if v_product < 1 or v_product > 2147483647 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].productId';
    end if;
  end if;
      v_tmp := v_item -> 'lineTotalPiastres';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].lineTotalPiastres';
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].lineTotalPiastres';
    end if;
    v_total := (v_tmp #>> '{}')::bigint;
    if v_total < 0 or v_total > 10000000000 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].lineTotalPiastres';
    end if;
  end if;
      v_tmp := v_item -> 'zeroCostReason';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    v_reason := null;
  elsif jsonb_typeof(v_tmp) = 'string' then
    v_reason := nullif(btrim(normalize((v_tmp #>> '{}'), NFC), E' \t\r\n'), '');
  else
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].zeroCostReason';
  end if;
  if v_reason is null then
    null;
  elsif char_length(v_reason) < 3 or char_length(v_reason) > 200 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].zeroCostReason';
  end if;
      if (v_total = 0) <> (v_reason is not null) then
        raise exception 'ZELL_INV_ZERO_COST_RULE' using errcode = '45215', detail = 'lines[' || v_i || '].zeroCostReason';
      end if;
      if v_kind = 'roll' then
        v_tmp := v_item -> 'widthCm';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].widthCm';
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].widthCm';
    end if;
    v_width := (v_tmp #>> '{}')::bigint;
    if v_width < 1 or v_width > 1000 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].widthCm';
    end if;
  end if;
        v_tmp := v_item -> 'rolls';
        if v_tmp is null or jsonb_typeof(v_tmp) is distinct from 'array'
           or jsonb_array_length(v_tmp) < 1 or jsonb_array_length(v_tmp) > 200 then
          raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].rolls';
        end if;
        v_rolls := '[]'::jsonb;
        for v_j in 0 .. jsonb_array_length(v_item -> 'rolls') - 1 loop
          v_roll := (v_item -> 'rolls') -> v_j;
          if jsonb_typeof(v_roll) <> 'object' then
            raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].rolls[' || v_j || ']';
          end if;
          for v_key in select jsonb_object_keys(v_roll) loop
    if not (v_key = any (array['lengthCm']::text[])) then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].rolls[' || v_j || '].' || left(v_key, 40);
    end if;
  end loop;
          v_tmp := v_roll -> 'lengthCm';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].rolls[' || v_j || '].lengthCm';
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].rolls[' || v_j || '].lengthCm';
    end if;
    v_len := (v_tmp #>> '{}')::bigint;
    if v_len < 1 or v_len > 100000 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].rolls[' || v_j || '].lengthCm';
    end if;
  end if;
          v_rolls := v_rolls || jsonb_build_array(jsonb_build_object('lengthCm', v_len));
        end loop;
        v_lots := v_lots + jsonb_array_length(v_rolls);
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'kind', 'roll', 'productId', v_product, 'widthCm', v_width, 'rolls', v_rolls,
          'lineTotalPiastres', v_total, 'zeroCostReason', v_reason));
      else
        v_tmp := v_item -> 'quantity';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].quantity';
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].quantity';
    end if;
    v_qty := (v_tmp #>> '{}')::bigint;
    if v_qty < 1 or v_qty > 1000000 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].quantity';
    end if;
  end if;
        v_lots := v_lots + 1;
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'kind', 'batch', 'productId', v_product, 'quantity', v_qty,
          'lineTotalPiastres', v_total, 'zeroCostReason', v_reason));
      end if;
    end loop;
    if v_lots > 200 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines.lots';
    end if;
  end if;

  return jsonb_build_object(
    'supplierId', v_supplier_id, 'supplierRef', v_ref, 'locationId', v_location_id,
    'docDate', to_char(v_date, 'YYYY-MM-DD'), 'note', v_note, 'charges', v_charges,
    'supplierDiscountPiastres', v_discount, 'lines', v_lines);
end
$fn$;

create function public.zell_inv_normalize_opening(p_doc jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_tmp jsonb;
  v_key text;
  v_arr jsonb;
  v_item jsonb;
  v_roll jsonb;
  v_i integer;
  v_j integer;
  v_kind text;
  v_location_id bigint;
  v_date date;
  v_note text;
  v_lines jsonb := '[]'::jsonb;
  v_rolls jsonb;
  v_product bigint;
  v_width bigint;
  v_qty bigint;
  v_total bigint;
  v_len bigint;
  v_reason text;
  v_estimated boolean;
  v_enote text;
  v_lots integer := 0;
begin
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'doc';
  end if;
  if octet_length(p_doc::text) > 131072 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'doc.size';
  end if;
  for v_key in select jsonb_object_keys(p_doc) loop
    if not (v_key = any (array['locationId', 'asOfDate', 'note', 'lines']::text[])) then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'doc.' || left(v_key, 40);
    end if;
  end loop;
  v_tmp := p_doc -> 'locationId';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'locationId';
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'locationId';
    end if;
    v_location_id := (v_tmp #>> '{}')::bigint;
    if v_location_id < 1 or v_location_id > 9223372036854775806 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'locationId';
    end if;
  end if;
  v_tmp := p_doc -> 'asOfDate';
  if v_tmp is null or jsonb_typeof(v_tmp) is distinct from 'string'
     or (v_tmp #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'asOfDate';
  end if;
  begin
    v_date := (v_tmp #>> '{}')::date;
  exception when others then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'asOfDate';
  end;
  if to_char(v_date, 'YYYY-MM-DD') <> (v_tmp #>> '{}') then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'asOfDate';
  end if;
  v_tmp := p_doc -> 'note';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    v_note := null;
  elsif jsonb_typeof(v_tmp) = 'string' then
    v_note := nullif(btrim(normalize((v_tmp #>> '{}'), NFC), E' \t\r\n'), '');
  else
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'note';
  end if;
  if v_note is null then
    null;
  elsif char_length(v_note) < 1 or char_length(v_note) > 500 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'note';
  end if;

  v_arr := p_doc -> 'lines';
  if v_arr is not null and jsonb_typeof(v_arr) <> 'null' then
    if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) > 100 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines';
    end if;
    for v_i in 0 .. jsonb_array_length(v_arr) - 1 loop
      v_item := v_arr -> v_i;
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || ']';
      end if;
      v_kind := case when jsonb_typeof(v_item -> 'kind') = 'string' then v_item ->> 'kind' end;
      if v_kind is null or v_kind not in ('roll', 'batch') then
        raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].kind';
      end if;
      if v_kind = 'roll' then
        for v_key in select jsonb_object_keys(v_item) loop
    if not (v_key = any (array['kind', 'productId', 'widthCm', 'rolls', 'lineTotalPiastres', 'costIsEstimated', 'estimateNote', 'zeroCostReason']::text[])) then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].' || left(v_key, 40);
    end if;
  end loop;
      else
        for v_key in select jsonb_object_keys(v_item) loop
    if not (v_key = any (array['kind', 'productId', 'quantity', 'lineTotalPiastres', 'costIsEstimated', 'estimateNote', 'zeroCostReason']::text[])) then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].' || left(v_key, 40);
    end if;
  end loop;
      end if;
      v_tmp := v_item -> 'productId';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].productId';
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].productId';
    end if;
    v_product := (v_tmp #>> '{}')::bigint;
    if v_product < 1 or v_product > 2147483647 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].productId';
    end if;
  end if;
      v_tmp := v_item -> 'lineTotalPiastres';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].lineTotalPiastres';
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].lineTotalPiastres';
    end if;
    v_total := (v_tmp #>> '{}')::bigint;
    if v_total < 0 or v_total > 10000000000 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].lineTotalPiastres';
    end if;
  end if;
      v_tmp := v_item -> 'costIsEstimated';
  if v_tmp is null or jsonb_typeof(v_tmp) is distinct from 'boolean' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].costIsEstimated';
  end if;
  v_estimated := (v_tmp #>> '{}')::boolean;
      v_tmp := v_item -> 'estimateNote';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    v_enote := null;
  elsif jsonb_typeof(v_tmp) = 'string' then
    v_enote := nullif(btrim(normalize((v_tmp #>> '{}'), NFC), E' \t\r\n'), '');
  else
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].estimateNote';
  end if;
  if v_enote is null then
    null;
  elsif char_length(v_enote) < 3 or char_length(v_enote) > 200 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].estimateNote';
  end if;
      v_tmp := v_item -> 'zeroCostReason';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    v_reason := null;
  elsif jsonb_typeof(v_tmp) = 'string' then
    v_reason := nullif(btrim(normalize((v_tmp #>> '{}'), NFC), E' \t\r\n'), '');
  else
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].zeroCostReason';
  end if;
  if v_reason is null then
    null;
  elsif char_length(v_reason) < 3 or char_length(v_reason) > 200 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].zeroCostReason';
  end if;
      if v_estimated <> (v_enote is not null) then
        raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].estimateNote';
      end if;
      if v_total = 0 and (v_reason is null or v_estimated) then
        raise exception 'ZELL_INV_ZERO_COST_RULE' using errcode = '45215', detail = 'lines[' || v_i || '].zeroCostReason';
      end if;
      if v_total > 0 and v_reason is not null then
        raise exception 'ZELL_INV_ZERO_COST_RULE' using errcode = '45215', detail = 'lines[' || v_i || '].zeroCostReason';
      end if;
      if v_kind = 'roll' then
        v_tmp := v_item -> 'widthCm';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].widthCm';
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].widthCm';
    end if;
    v_width := (v_tmp #>> '{}')::bigint;
    if v_width < 1 or v_width > 1000 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].widthCm';
    end if;
  end if;
        v_tmp := v_item -> 'rolls';
        if v_tmp is null or jsonb_typeof(v_tmp) is distinct from 'array'
           or jsonb_array_length(v_tmp) < 1 or jsonb_array_length(v_tmp) > 200 then
          raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].rolls';
        end if;
        v_rolls := '[]'::jsonb;
        for v_j in 0 .. jsonb_array_length(v_item -> 'rolls') - 1 loop
          v_roll := (v_item -> 'rolls') -> v_j;
          if jsonb_typeof(v_roll) <> 'object' then
            raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].rolls[' || v_j || ']';
          end if;
          for v_key in select jsonb_object_keys(v_roll) loop
    if not (v_key = any (array['lengthCm']::text[])) then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].rolls[' || v_j || '].' || left(v_key, 40);
    end if;
  end loop;
          v_tmp := v_roll -> 'lengthCm';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].rolls[' || v_j || '].lengthCm';
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].rolls[' || v_j || '].lengthCm';
    end if;
    v_len := (v_tmp #>> '{}')::bigint;
    if v_len < 1 or v_len > 100000 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].rolls[' || v_j || '].lengthCm';
    end if;
  end if;
          v_rolls := v_rolls || jsonb_build_array(jsonb_build_object('lengthCm', v_len));
        end loop;
        v_lots := v_lots + jsonb_array_length(v_rolls);
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'kind', 'roll', 'productId', v_product, 'widthCm', v_width, 'rolls', v_rolls,
          'lineTotalPiastres', v_total, 'costIsEstimated', v_estimated, 'estimateNote', v_enote,
          'zeroCostReason', v_reason));
      else
        v_tmp := v_item -> 'quantity';
  if v_tmp is null or jsonb_typeof(v_tmp) = 'null' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].quantity';
  else
    if jsonb_typeof(v_tmp) <> 'number' or (v_tmp #>> '{}') !~ '^-?[0-9]{1,15}$' then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].quantity';
    end if;
    v_qty := (v_tmp #>> '{}')::bigint;
    if v_qty < 1 or v_qty > 1000000 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines[' || v_i || '].quantity';
    end if;
  end if;
        v_lots := v_lots + 1;
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'kind', 'batch', 'productId', v_product, 'quantity', v_qty,
          'lineTotalPiastres', v_total, 'costIsEstimated', v_estimated, 'estimateNote', v_enote,
          'zeroCostReason', v_reason));
      end if;
    end loop;
    if v_lots > 200 then
      raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'lines.lots';
    end if;
  end if;

  return jsonb_build_object('locationId', v_location_id, 'asOfDate', to_char(v_date, 'YYYY-MM-DD'),
                            'note', v_note, 'lines', v_lines);
end
$fn$;

create function public.zell_inv_command_check(p_actor uuid, p_command_id uuid, p_kind text, p_hash text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_kind text;
  v_actor uuid;
  v_hash text;
  v_result jsonb;
begin
  select c.command_kind, c.actor_user_id, c.request_hash, c.result
    into v_kind, v_actor, v_hash, v_result
    from public.inventory_commands c
   where c.command_id = p_command_id;
  if not found then
    return null;
  end if;
  if v_kind = p_kind and v_actor = p_actor and v_hash = p_hash then
    return v_result || jsonb_build_object('replayed', true);
  end if;
  raise exception 'ZELL_INV_COMMAND_MISMATCH' using errcode = '45212';
end
$fn$;

-- نقطة التوسعة لـ0021 (بيستبدلها قبل إتاحة أي حركة — §8).
create function public.zell_inv_doc_void_blockers(p_source text, p_doc_id bigint)
returns text[]
language sql
stable
set search_path = ''
as $fn$
  select '{}'::text[];
$fn$;

-- أي FK من جدول برّه 0020 بيشاور على المستندات أو البنود أو الـlots = اعتمادية مش معروفة.
create function public.zell_inv_unknown_lot_references()
returns text[]
language sql
stable
set search_path = ''
as $fn$
  select coalesce(array_agg(distinct c.conrelid::regclass::text || ' -> ' || c.confrelid::regclass::text), '{}'::text[])
    from pg_catalog.pg_constraint c
   where c.contype = 'f'
     and c.confrelid::regclass in ('public.stock_lots'::regclass, 'public.purchase_doc_lines'::regclass,
                                   'public.opening_stock_lines'::regclass, 'public.purchase_docs'::regclass,
                                   'public.opening_stock_docs'::regclass)
     and (c.conrelid::regclass, c.confrelid::regclass) not in (
       ('public.purchase_doc_lines'::regclass, 'public.purchase_docs'::regclass),
       ('public.purchase_doc_charges'::regclass, 'public.purchase_docs'::regclass),
       ('public.opening_stock_lines'::regclass, 'public.opening_stock_docs'::regclass),
       ('public.stock_lots'::regclass, 'public.purchase_doc_lines'::regclass),
       ('public.stock_lots'::regclass, 'public.opening_stock_lines'::regclass));
$fn$;

create function public.zell_inv_void_contract_version()
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select 1;
$fn$;


-- (6) دوال الـtriggers (مالكها postgres). بتمنع الـDML المباشر، ومش حاجز ضد مالك الكائنات المتعمد.
create function public.zell_inv_trg_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = tg_table_name || '.delete';
end
$fn$;

create function public.zell_inv_trg_no_truncate()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = tg_table_name || '.truncate';
end
$fn$;

create function public.zell_inv_trg_append_only()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = tg_table_name || '.update';
end
$fn$;

-- §5.2: الأعمدة المسموح تتغير في كل انتقال. id و doc_no و created_at و created_by ثابتين دايمًا.
create function public.zell_inv_trg_doc_guard()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_allowed text[];
begin
  if tg_table_name = 'purchase_docs' then
    if old.status = 'draft' and new.status = 'draft' then
      v_allowed := array['supplier_id', 'supplier_ref', 'location_id', 'doc_date', 'note', 'draft_payload',
                         'supplier_discount_piastres', 'items_subtotal_piastres', 'extras_total_piastres',
                         'total_cost_piastres', 'line_count', 'charge_count', 'version', 'updated_at', 'updated_by'];
    elsif old.status = 'draft' and new.status = 'posted' then
      v_allowed := array['status', 'draft_payload', 'items_subtotal_piastres', 'extras_total_piastres',
                         'total_cost_piastres', 'line_count', 'charge_count', 'lot_count', 'supplier_name_snapshot',
                         'location_name_snapshot', 'posted_at', 'posted_by', 'version', 'updated_at', 'updated_by'];
    elsif old.status = 'draft' and new.status = 'discarded' then
      v_allowed := array['status', 'discarded_at', 'discarded_by', 'discard_reason', 'version', 'updated_at', 'updated_by'];
    elsif old.status = 'posted' and new.status = 'voided' then
      v_allowed := array['status', 'voided_at', 'voided_by', 'void_reason', 'version', 'updated_at', 'updated_by'];
    else
      raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = 'purchase_docs.transition';
    end if;
  else
    if old.status = 'draft' and new.status = 'draft' then
      v_allowed := array['location_id', 'as_of_date', 'note', 'draft_payload', 'items_total_piastres',
                         'estimated_total_piastres', 'line_count', 'version', 'updated_at', 'updated_by'];
    elsif old.status = 'draft' and new.status = 'posted' then
      v_allowed := array['status', 'draft_payload', 'items_total_piastres', 'estimated_total_piastres', 'line_count',
                         'lot_count', 'location_name_snapshot', 'posted_at', 'posted_by', 'version', 'updated_at', 'updated_by'];
    elsif old.status = 'draft' and new.status = 'discarded' then
      v_allowed := array['status', 'discarded_at', 'discarded_by', 'discard_reason', 'version', 'updated_at', 'updated_by'];
    elsif old.status = 'posted' and new.status = 'voided' then
      v_allowed := array['status', 'voided_at', 'voided_by', 'void_reason', 'version', 'updated_at', 'updated_by'];
    else
      raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = 'opening_stock_docs.transition';
    end if;
  end if;
  if (to_jsonb(old) - v_allowed) is distinct from (to_jsonb(new) - v_allowed) then
    raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = tg_table_name || '.columns';
  end if;
  return new;
end
$fn$;

create function public.zell_inv_trg_child_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_status text;
  v_location bigint;
  v_received date;
  v_product integer;
  v_width integer;
  v_estimated boolean;
begin
  if tg_table_name in ('purchase_doc_lines', 'purchase_doc_charges') then
    select d.status into v_status from public.purchase_docs d where d.id = new.doc_id;
    if v_status is distinct from 'draft' then
      raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = tg_table_name || '.parent_not_draft';
    end if;
  elsif tg_table_name = 'opening_stock_lines' then
    select d.status into v_status from public.opening_stock_docs d where d.id = new.doc_id;
    if v_status is distinct from 'draft' then
      raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = tg_table_name || '.parent_not_draft';
    end if;
  else
    if new.source_kind = 'purchase' then
      select d.status, d.location_id, d.doc_date, l.product_id, l.width_cm_snapshot, false
        into v_status, v_location, v_received, v_product, v_width, v_estimated
        from public.purchase_doc_lines l
        join public.purchase_docs d on d.id = l.doc_id
       where l.id = new.purchase_line_id;
    else
      select d.status, d.location_id, d.as_of_date, l.product_id, l.width_cm_snapshot, l.cost_is_estimated
        into v_status, v_location, v_received, v_product, v_width, v_estimated
        from public.opening_stock_lines l
        join public.opening_stock_docs d on d.id = l.doc_id
       where l.id = new.opening_line_id;
    end if;
    if v_status is distinct from 'draft' then
      raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = 'stock_lots.parent_not_draft';
    end if;
    if new.product_id is distinct from v_product or new.location_id is distinct from v_location
       or new.received_on is distinct from v_received or new.width_cm_snapshot is distinct from v_width
       or new.cost_is_estimated is distinct from v_estimated then
      raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = 'stock_lots.mismatch';
    end if;
  end if;
  return new;
end
$fn$;

create function public.zell_inv_trg_lot_update_guard()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_status text;
begin
  if not (old.status = 'active' and new.status = 'voided') then
    raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = 'stock_lots.transition';
  end if;
  if (to_jsonb(old) - array['status', 'voided_at', 'voided_by']) is distinct from
     (to_jsonb(new) - array['status', 'voided_at', 'voided_by']) then
    raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = 'stock_lots.columns';
  end if;
  if new.source_kind = 'purchase' then
    select d.status into v_status
      from public.purchase_doc_lines l join public.purchase_docs d on d.id = l.doc_id
     where l.id = new.purchase_line_id;
  else
    select d.status into v_status
      from public.opening_stock_lines l join public.opening_stock_docs d on d.id = l.doc_id
     where l.id = new.opening_line_id;
  end if;
  if v_status is distinct from 'voided' then
    raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = 'stock_lots.parent_not_voided';
  end if;
  return new;
end
$fn$;

create function public.zell_inv_trg_master_guard()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = tg_table_name || '.identity';
  end if;
  if tg_table_name = 'inventory_locations' then
    if new.code is distinct from old.code then
      raise exception 'ZELL_INV_IMMUTABLE' using errcode = '45216', detail = 'inventory_locations.code';
    end if;
    if new.is_default is distinct from old.is_default then
      raise exception 'ZELL_INV_MAIN_LOCKED' using errcode = '45220', detail = 'inventory_locations.is_default';
    end if;
    if old.code = 'MAIN' and new.is_active is distinct from old.is_active then
      raise exception 'ZELL_INV_MAIN_LOCKED' using errcode = '45220', detail = 'inventory_locations.is_active';
    end if;
  end if;
  return new;
end
$fn$;

-- definer مملوك لـ postgres (INHERIT FALSE ⇒ مفيش وراثة من zell_inventory_definer). قراءة بس.
create function public.zell_inv_trg_products_sale_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if public.zell_inv_product_has_stock_refs(new.id) then
    raise exception 'ZELL_INV_SALE_UNIT_LOCKED' using errcode = '45217', detail = 'products.sale_unit';
  end if;
  return new;
end
$fn$;


-- (7) RPCs: المواقع والموردين
create function public.zell_inv_create_location(p_actor uuid, p_command_id uuid, p_code text, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_code text;
  v_name text;
  v_hash text;
  v_replay jsonb;
  v_row public.inventory_locations;
  v_result jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  v_code := nullif(btrim(normalize(p_code, NFC), E' \t\r\n'), '');
  if v_code is null or v_code !~ '^[A-Z0-9_-]{2,20}$' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'code';
  end if;
  v_name := nullif(btrim(normalize(p_name, NFC), E' \t\r\n'), '');
  if v_name is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'name';
  elsif char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'name';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'location.create', 'targetId', null::bigint, 'expectedVersion', null::integer, 'reason', null::text, 'payload', jsonb_build_object('code', v_code, 'name', v_name))::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'location.create', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  if exists (select 1 from public.inventory_locations l where l.code = v_code) then
    raise exception 'ZELL_INV_LOCATION_CODE_TAKEN' using errcode = '45219', detail = 'code';
  end if;
  begin
    insert into public.inventory_locations (code, name, is_default, is_active, created_by, updated_by)
    values (v_code, v_name, false, true, p_actor, p_actor)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'ZELL_INV_LOCATION_CODE_TAKEN' using errcode = '45219', detail = 'code';
  end;
  v_result := jsonb_build_object('locationId', v_row.id, 'version', v_row.version);
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'location.create', 'location', v_row.id, v_row.version, null::jsonb, to_jsonb(v_row));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'location.create', p_actor, v_hash, 'location', v_row.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;

create function public.zell_inv_update_location(p_actor uuid, p_command_id uuid, p_location_id bigint,
                                                p_expected_version integer, p_name text, p_is_active boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_name text;
  v_hash text;
  v_replay jsonb;
  v_old public.inventory_locations;
  v_new public.inventory_locations;
  v_result jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  if p_location_id is null or p_expected_version is null or p_is_active is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'locationId';
  end if;
  v_name := nullif(btrim(normalize(p_name, NFC), E' \t\r\n'), '');
  if v_name is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'name';
  elsif char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'name';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'location.update', 'targetId', p_location_id, 'expectedVersion', p_expected_version, 'reason', null::text, 'payload', jsonb_build_object('name', v_name, 'isActive', p_is_active))::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'location.update', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  select * into v_old from public.inventory_locations l where l.id = p_location_id for update;
  if not found then
    raise exception 'ZELL_INV_NOT_FOUND' using errcode = '45201', detail = 'locationId';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'ZELL_INV_CONFLICT' using errcode = '45202', detail = 'expectedVersion';
  end if;
  if v_old.code = 'MAIN' and p_is_active is distinct from v_old.is_active then
    raise exception 'ZELL_INV_MAIN_LOCKED' using errcode = '45220', detail = 'isActive';
  end if;
  update public.inventory_locations l
     set name = v_name, is_active = p_is_active, version = l.version + 1, updated_at = now(), updated_by = p_actor
   where l.id = p_location_id
  returning * into v_new;
  v_result := jsonb_build_object('locationId', v_new.id, 'version', v_new.version);
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'location.update', 'location', v_new.id, v_new.version, to_jsonb(v_old), to_jsonb(v_new));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'location.update', p_actor, v_hash, 'location', v_new.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;

create function public.zell_inv_create_supplier(p_actor uuid, p_command_id uuid, p_name text, p_phone text, p_note text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_name text;
  v_key text;
  v_phone text;
  v_note text;
  v_hash text;
  v_replay jsonb;
  v_row public.suppliers;
  v_result jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  v_name := nullif(btrim(normalize(p_name, NFC), E' \t\r\n'), '');
  if v_name is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'name';
  elsif char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'name';
  end if;
  v_key := lower(regexp_replace(v_name, '\s+', ' ', 'g'));
  v_phone := nullif(regexp_replace(coalesce(normalize(p_phone, NFC), ''), '[\s-]', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^\+?[0-9]{6,15}$' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'phone';
  end if;
  v_note := nullif(btrim(normalize(p_note, NFC), E' \t\r\n'), '');
  if v_note is null then
    null;
  elsif char_length(v_note) < 1 or char_length(v_note) > 500 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'note';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'supplier.create', 'targetId', null::bigint, 'expectedVersion', null::integer, 'reason', null::text, 'payload', jsonb_build_object('name', v_name, 'phone', v_phone, 'note', v_note))::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'supplier.create', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  if exists (select 1 from public.suppliers s where s.name_key = v_key) then
    raise exception 'ZELL_INV_SUPPLIER_NAME_TAKEN' using errcode = '45218', detail = 'name';
  end if;
  begin
    insert into public.suppliers (name, name_key, phone, note, is_active, created_by, updated_by)
    values (v_name, v_key, v_phone, v_note, true, p_actor, p_actor)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'ZELL_INV_SUPPLIER_NAME_TAKEN' using errcode = '45218', detail = 'name';
  end;
  v_result := jsonb_build_object('supplierId', v_row.id, 'version', v_row.version);
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'supplier.create', 'supplier', v_row.id, v_row.version, null::jsonb, to_jsonb(v_row));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'supplier.create', p_actor, v_hash, 'supplier', v_row.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;

create function public.zell_inv_update_supplier(p_actor uuid, p_command_id uuid, p_supplier_id bigint,
                                                p_expected_version integer, p_name text, p_phone text,
                                                p_note text, p_is_active boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_name text;
  v_key text;
  v_phone text;
  v_note text;
  v_hash text;
  v_replay jsonb;
  v_old public.suppliers;
  v_new public.suppliers;
  v_result jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  if p_supplier_id is null or p_expected_version is null or p_is_active is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'supplierId';
  end if;
  v_name := nullif(btrim(normalize(p_name, NFC), E' \t\r\n'), '');
  if v_name is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'name';
  elsif char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'name';
  end if;
  v_key := lower(regexp_replace(v_name, '\s+', ' ', 'g'));
  v_phone := nullif(regexp_replace(coalesce(normalize(p_phone, NFC), ''), '[\s-]', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^\+?[0-9]{6,15}$' then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'phone';
  end if;
  v_note := nullif(btrim(normalize(p_note, NFC), E' \t\r\n'), '');
  if v_note is null then
    null;
  elsif char_length(v_note) < 1 or char_length(v_note) > 500 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'note';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'supplier.update', 'targetId', p_supplier_id, 'expectedVersion', p_expected_version, 'reason', null::text, 'payload', jsonb_build_object('name', v_name, 'phone', v_phone, 'note', v_note, 'isActive', p_is_active))::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'supplier.update', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  select * into v_old from public.suppliers s where s.id = p_supplier_id for update;
  if not found then
    raise exception 'ZELL_INV_NOT_FOUND' using errcode = '45201', detail = 'supplierId';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'ZELL_INV_CONFLICT' using errcode = '45202', detail = 'expectedVersion';
  end if;
  if exists (select 1 from public.suppliers s where s.name_key = v_key and s.id <> p_supplier_id) then
    raise exception 'ZELL_INV_SUPPLIER_NAME_TAKEN' using errcode = '45218', detail = 'name';
  end if;
  begin
    update public.suppliers s
       set name = v_name, name_key = v_key, phone = v_phone, note = v_note, is_active = p_is_active,
           version = s.version + 1, updated_at = now(), updated_by = p_actor
     where s.id = p_supplier_id
    returning * into v_new;
  exception when unique_violation then
    raise exception 'ZELL_INV_SUPPLIER_NAME_TAKEN' using errcode = '45218', detail = 'name';
  end;
  v_result := jsonb_build_object('supplierId', v_new.id, 'version', v_new.version);
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'supplier.update', 'supplier', v_new.id, v_new.version, to_jsonb(v_old), to_jsonb(v_new));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'supplier.update', p_actor, v_hash, 'supplier', v_new.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;


-- (8) RPCs: مستندات الشراء
create function public.zell_inv_create_purchase(p_actor uuid, p_command_id uuid, p_doc jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_doc jsonb;
  v_hash text;
  v_replay jsonb;
  v_prod jsonb;
  v_item jsonb;
  v_p jsonb;
  v_i integer;
  v_loc_active boolean;
  v_sup_active boolean;
  v_v bigint;
  v_e bigint;
  v_d bigint;
  v_result jsonb;
  v_seq bigint;
  v_row public.purchase_docs;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  v_doc := public.zell_inv_normalize_purchase(p_doc);
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'purchase.create', 'targetId', null::bigint, 'expectedVersion', null::integer, 'reason', null::text, 'payload', v_doc)::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'purchase.create', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  select l.is_active into v_loc_active
    from public.inventory_locations l where l.id = (v_doc ->> 'locationId')::bigint for share;
  if v_loc_active is not true then
    raise exception 'ZELL_INV_LOCATION_INACTIVE' using errcode = '45205', detail = 'locationId';
  end if;
  if (v_doc ->> 'supplierId') is not null then
    select s.is_active into v_sup_active
      from public.suppliers s where s.id = (v_doc ->> 'supplierId')::bigint for share;
    if v_sup_active is not true then
      raise exception 'ZELL_INV_SUPPLIER_INACTIVE' using errcode = '45204', detail = 'supplierId';
    end if;
  end if;
  if (v_doc ->> 'docDate')::date > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'ZELL_INV_DATE_IN_FUTURE' using errcode = '45221', detail = 'docDate';
  end if;
  select coalesce(jsonb_object_agg(r.product_id::text, jsonb_build_object('name', r.name_ar, 'unit', r.sale_unit, 'base', r.base_width_cm, 'widths', to_jsonb(r.active_widths))), '{}'::jsonb)
    into v_prod
    from public.zell_inv_read_products(array(select distinct (e ->> 'productId')::integer from jsonb_array_elements(v_doc -> 'lines') e order by 1)) r;
  for v_i in 0 .. jsonb_array_length(v_doc -> 'lines') - 1 loop
    v_item := v_doc -> 'lines' -> v_i;
    v_p := v_prod -> (v_item ->> 'productId');
    if v_p is null or (v_p ->> 'unit') is distinct from (case when v_item ->> 'kind' = 'roll' then 'meter' else 'piece' end) then
      raise exception 'ZELL_INV_PRODUCT_UNIT' using errcode = '45206', detail = 'lines[' || v_i || '].productId';
    end if;
    if v_item ->> 'kind' = 'roll' then
      if not public.zell_inv_width_allowed((v_p ->> 'base')::integer,
                                           array(select x::integer from jsonb_array_elements_text(v_p -> 'widths') x),
                                           (v_item ->> 'widthCm')::integer) then
        raise exception 'ZELL_INV_WIDTH_NOT_ALLOWED' using errcode = '45207', detail = 'lines[' || v_i || '].widthCm';
      end if;
    end if;
  end loop;
  select coalesce(sum((e ->> 'lineTotalPiastres')::bigint), 0) into v_v from jsonb_array_elements(v_doc -> 'lines') e;
  select coalesce(sum((e ->> 'amountPiastres')::bigint), 0) into v_e from jsonb_array_elements(v_doc -> 'charges') e;
  v_d := (v_doc ->> 'supplierDiscountPiastres')::bigint;
  v_seq := nextval('public.purchase_doc_no_seq');
  insert into public.purchase_docs (
    doc_no, status, supplier_id, supplier_ref, location_id, doc_date, note, draft_payload,
    supplier_discount_piastres, items_subtotal_piastres, extras_total_piastres, total_cost_piastres,
    line_count, charge_count, created_by, updated_by)
  values (
    'PUR-' || case when v_seq < 1000000 then lpad(v_seq::text, 6, '0') else v_seq::text end, 'draft', (v_doc ->> 'supplierId')::bigint, v_doc ->> 'supplierRef',
    (v_doc ->> 'locationId')::bigint, (v_doc ->> 'docDate')::date, v_doc ->> 'note', v_doc,
    v_d, v_v, v_e, v_v + v_e - v_d,
    jsonb_array_length(v_doc -> 'lines'), jsonb_array_length(v_doc -> 'charges'), p_actor, p_actor)
  returning * into v_row;
  v_result := jsonb_build_object('docId', v_row.id, 'docNo', v_row.doc_no, 'status', v_row.status,
                                 'version', v_row.version, 'totals', jsonb_build_object(
      'itemsSubtotalPiastres', v_row.items_subtotal_piastres, 'extrasTotalPiastres', v_row.extras_total_piastres,
      'supplierDiscountPiastres', v_row.supplier_discount_piastres, 'totalCostPiastres', v_row.total_cost_piastres));
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'purchase.create', 'purchase', v_row.id, v_row.version, null::jsonb, to_jsonb(v_row));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'purchase.create', p_actor, v_hash, 'purchase', v_row.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;

create function public.zell_inv_update_purchase(p_actor uuid, p_command_id uuid, p_doc_id bigint,
                                                p_expected_version integer, p_doc jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_doc jsonb;
  v_hash text;
  v_replay jsonb;
  v_prod jsonb;
  v_item jsonb;
  v_p jsonb;
  v_i integer;
  v_loc_active boolean;
  v_sup_active boolean;
  v_v bigint;
  v_e bigint;
  v_d bigint;
  v_result jsonb;
  v_old public.purchase_docs;
  v_new public.purchase_docs;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  v_doc := public.zell_inv_normalize_purchase(p_doc);
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'purchase.update', 'targetId', p_doc_id, 'expectedVersion', p_expected_version, 'reason', null::text, 'payload', v_doc)::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'purchase.update', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  select * into v_old from public.purchase_docs d where d.id = p_doc_id for update;
  if not found then
    raise exception 'ZELL_INV_NOT_FOUND' using errcode = '45201', detail = 'docId';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'ZELL_INV_CONFLICT' using errcode = '45202', detail = 'expectedVersion';
  end if;
  if v_old.status <> 'draft' then
    raise exception 'ZELL_INV_NOT_DRAFT' using errcode = '45208', detail = 'status';
  end if;
  select l.is_active into v_loc_active
    from public.inventory_locations l where l.id = (v_doc ->> 'locationId')::bigint for share;
  if v_loc_active is not true then
    raise exception 'ZELL_INV_LOCATION_INACTIVE' using errcode = '45205', detail = 'locationId';
  end if;
  if (v_doc ->> 'supplierId') is not null then
    select s.is_active into v_sup_active
      from public.suppliers s where s.id = (v_doc ->> 'supplierId')::bigint for share;
    if v_sup_active is not true then
      raise exception 'ZELL_INV_SUPPLIER_INACTIVE' using errcode = '45204', detail = 'supplierId';
    end if;
  end if;
  if (v_doc ->> 'docDate')::date > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'ZELL_INV_DATE_IN_FUTURE' using errcode = '45221', detail = 'docDate';
  end if;
  select coalesce(jsonb_object_agg(r.product_id::text, jsonb_build_object('name', r.name_ar, 'unit', r.sale_unit, 'base', r.base_width_cm, 'widths', to_jsonb(r.active_widths))), '{}'::jsonb)
    into v_prod
    from public.zell_inv_read_products(array(select distinct (e ->> 'productId')::integer from jsonb_array_elements(v_doc -> 'lines') e order by 1)) r;
  for v_i in 0 .. jsonb_array_length(v_doc -> 'lines') - 1 loop
    v_item := v_doc -> 'lines' -> v_i;
    v_p := v_prod -> (v_item ->> 'productId');
    if v_p is null or (v_p ->> 'unit') is distinct from (case when v_item ->> 'kind' = 'roll' then 'meter' else 'piece' end) then
      raise exception 'ZELL_INV_PRODUCT_UNIT' using errcode = '45206', detail = 'lines[' || v_i || '].productId';
    end if;
    if v_item ->> 'kind' = 'roll' then
      if not public.zell_inv_width_allowed((v_p ->> 'base')::integer,
                                           array(select x::integer from jsonb_array_elements_text(v_p -> 'widths') x),
                                           (v_item ->> 'widthCm')::integer) then
        raise exception 'ZELL_INV_WIDTH_NOT_ALLOWED' using errcode = '45207', detail = 'lines[' || v_i || '].widthCm';
      end if;
    end if;
  end loop;
  select coalesce(sum((e ->> 'lineTotalPiastres')::bigint), 0) into v_v from jsonb_array_elements(v_doc -> 'lines') e;
  select coalesce(sum((e ->> 'amountPiastres')::bigint), 0) into v_e from jsonb_array_elements(v_doc -> 'charges') e;
  v_d := (v_doc ->> 'supplierDiscountPiastres')::bigint;
  update public.purchase_docs d
     set supplier_id = (v_doc ->> 'supplierId')::bigint, supplier_ref = v_doc ->> 'supplierRef',
         location_id = (v_doc ->> 'locationId')::bigint, doc_date = (v_doc ->> 'docDate')::date,
         note = v_doc ->> 'note', draft_payload = v_doc,
         supplier_discount_piastres = v_d, items_subtotal_piastres = v_v, extras_total_piastres = v_e,
         total_cost_piastres = v_v + v_e - v_d,
         line_count = jsonb_array_length(v_doc -> 'lines'), charge_count = jsonb_array_length(v_doc -> 'charges'),
         version = d.version + 1, updated_at = now(), updated_by = p_actor
   where d.id = p_doc_id
  returning * into v_new;
  v_result := jsonb_build_object('docId', v_new.id, 'docNo', v_new.doc_no, 'status', v_new.status,
                                 'version', v_new.version, 'totals', jsonb_build_object(
      'itemsSubtotalPiastres', v_new.items_subtotal_piastres, 'extrasTotalPiastres', v_new.extras_total_piastres,
      'supplierDiscountPiastres', v_new.supplier_discount_piastres, 'totalCostPiastres', v_new.total_cost_piastres));
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'purchase.update', 'purchase', v_new.id, v_new.version, to_jsonb(v_old), to_jsonb(v_new));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'purchase.update', p_actor, v_hash, 'purchase', v_new.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;

create function public.zell_inv_post_purchase(p_actor uuid, p_command_id uuid, p_doc_id bigint, p_expected_version integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_hash text;
  v_replay jsonb;
  v_old public.purchase_docs;
  v_new public.purchase_docs;
  v_doc jsonb;
  v_lines jsonb;
  v_charges jsonb;
  v_item jsonb;
  v_p jsonb;
  v_prod jsonb;
  v_loc_active boolean;
  v_loc_name text;
  v_sup_active boolean;
  v_sup_name text;
  v_i integer;
  v_j integer;
  v_k integer;
  v_n integer;
  v_cnt integer;
  v_v bigint;
  v_e bigint;
  v_d bigint;
  v_total bigint;
  v_lens bigint[];
  v_bases bigint[] := '{}';
  v_lot_len integer[] := '{}';
  v_ext bigint[];
  v_dis bigint[];
  v_line_ext bigint;
  v_line_dis bigint;
  v_line_id bigint;
  v_lot_id bigint;
  v_lot_code text;
  v_seq bigint;
  v_landed bigint;
  v_lots jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'purchase.post', 'targetId', p_doc_id, 'expectedVersion', p_expected_version, 'reason', null::text, 'payload', null::jsonb)::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'purchase.post', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  select * into v_old from public.purchase_docs d where d.id = p_doc_id for update;
  if not found then
    raise exception 'ZELL_INV_NOT_FOUND' using errcode = '45201', detail = 'docId';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'ZELL_INV_CONFLICT' using errcode = '45202', detail = 'expectedVersion';
  end if;
  if v_old.status <> 'draft' then
    raise exception 'ZELL_INV_NOT_DRAFT' using errcode = '45208', detail = 'status';
  end if;
  v_doc := v_old.draft_payload;
  v_lines := v_doc -> 'lines';
  v_charges := v_doc -> 'charges';
  v_n := jsonb_array_length(v_lines);
  if v_n = 0 then
    raise exception 'ZELL_INV_EMPTY' using errcode = '45209', detail = 'lines';
  end if;

  -- إعادة التحقق الكاملة تحت أقفال
  select l.is_active, l.name into v_loc_active, v_loc_name
    from public.inventory_locations l where l.id = v_old.location_id for share;
  if v_loc_active is not true then
    raise exception 'ZELL_INV_LOCATION_INACTIVE' using errcode = '45205', detail = 'locationId';
  end if;
  if v_old.supplier_id is not null then
    select s.is_active, s.name into v_sup_active, v_sup_name
      from public.suppliers s where s.id = v_old.supplier_id for share;
    if v_sup_active is not true then
      raise exception 'ZELL_INV_SUPPLIER_INACTIVE' using errcode = '45204', detail = 'supplierId';
    end if;
  end if;
  if v_old.doc_date > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'ZELL_INV_DATE_IN_FUTURE' using errcode = '45221', detail = 'docDate';
  end if;
  select coalesce(jsonb_object_agg(r.product_id::text, jsonb_build_object('name', r.name_ar, 'unit', r.sale_unit, 'base', r.base_width_cm, 'widths', to_jsonb(r.active_widths))), '{}'::jsonb)
    into v_prod
    from public.zell_inv_lock_products(array(select distinct (e ->> 'productId')::integer from jsonb_array_elements(v_lines) e order by 1)) r;
  for v_i in 0 .. jsonb_array_length(v_lines) - 1 loop
    v_item := v_lines -> v_i;
    v_p := v_prod -> (v_item ->> 'productId');
    if v_p is null or (v_p ->> 'unit') is distinct from (case when v_item ->> 'kind' = 'roll' then 'meter' else 'piece' end) then
      raise exception 'ZELL_INV_PRODUCT_UNIT' using errcode = '45206', detail = 'lines[' || v_i || '].productId';
    end if;
    if v_item ->> 'kind' = 'roll' then
      if not public.zell_inv_width_allowed((v_p ->> 'base')::integer,
                                           array(select x::integer from jsonb_array_elements_text(v_p -> 'widths') x),
                                           (v_item ->> 'widthCm')::integer) then
        raise exception 'ZELL_INV_WIDTH_NOT_ALLOWED' using errcode = '45207', detail = 'lines[' || v_i || '].widthCm';
      end if;
    end if;
  end loop;

  select coalesce(sum((e ->> 'lineTotalPiastres')::bigint), 0) into v_v from jsonb_array_elements(v_lines) e;
  select coalesce(sum((e ->> 'amountPiastres')::bigint), 0) into v_e from jsonb_array_elements(v_charges) e;
  v_d := (v_doc ->> 'supplierDiscountPiastres')::bigint;
  if v_d is distinct from v_old.supplier_discount_piastres then
    raise exception 'ZELL_INV_INVARIANT_BROKEN' using detail = 'discount';
  end if;
  if (v_e > 0 or v_d > 0) and v_v = 0 then
    raise exception 'ZELL_INV_ALLOCATION_BASE_ZERO' using errcode = '45210', detail = 'lines';
  end if;
  if v_d > 0 and v_d >= v_v then
    raise exception 'ZELL_INV_DISCOUNT_TOO_LARGE' using errcode = '45211', detail = 'supplierDiscountPiastres';
  end if;

  -- (1) قاعدة كل lot: الرول بالطول، والدفعة = إجمالي البند
  for v_i in 0 .. v_n - 1 loop
    v_item := v_lines -> v_i;
    v_total := (v_item ->> 'lineTotalPiastres')::bigint;
    if v_item ->> 'kind' = 'roll' then
      v_lens := array(select (r.value ->> 'lengthCm')::bigint
                        from jsonb_array_elements(v_item -> 'rolls') with ordinality as r(value, ord)
                       order by r.ord);
      v_bases := v_bases || public.zell_inv_allocate_lr(v_total, v_lens);
      v_lot_len := v_lot_len || v_lens::integer[];
    else
      v_bases := v_bases || v_total;
      v_lot_len := v_lot_len || null::integer;
    end if;
  end loop;
  -- (2)(3) المصاريف والخصم كلٌّ لوحده بترتيب (line_no, lot_sequence)
  v_ext := public.zell_inv_allocate_lr(v_e, v_bases);
  v_dis := public.zell_inv_allocate_lr(v_d, v_bases);
  if (select coalesce(sum(x), 0) from unnest(v_bases) as x) <> v_v
     or (select coalesce(sum(x), 0) from unnest(v_ext) as x) <> v_e
     or (select coalesce(sum(x), 0) from unnest(v_dis) as x) <> v_d then
    raise exception 'ZELL_INV_INVARIANT_BROKEN' using detail = 'allocation';
  end if;

  v_k := 0;
  for v_i in 0 .. v_n - 1 loop
    v_item := v_lines -> v_i;
    v_p := v_prod -> (v_item ->> 'productId');
    v_total := (v_item ->> 'lineTotalPiastres')::bigint;
    v_cnt := case when v_item ->> 'kind' = 'roll' then jsonb_array_length(v_item -> 'rolls') else 1 end;
    v_line_ext := 0;
    v_line_dis := 0;
    for v_j in 1 .. v_cnt loop
      v_line_ext := v_line_ext + v_ext[v_k + v_j];
      v_line_dis := v_line_dis + v_dis[v_k + v_j];
    end loop;
    insert into public.purchase_doc_lines (
      doc_id, line_no, line_kind, product_id, product_name_snapshot, sale_unit_snapshot, width_cm_snapshot,
      roll_count, total_length_cm, quantity, line_total_piastres, zero_cost_reason,
      allocated_extras_piastres, allocated_discount_piastres, landed_total_piastres)
    values (
      p_doc_id, v_i + 1, v_item ->> 'kind', (v_item ->> 'productId')::integer,
      left(coalesce(nullif(btrim(v_p ->> 'name'), ''), 'منتج #' || (v_item ->> 'productId')), 200),
      v_p ->> 'unit',
      case when v_item ->> 'kind' = 'roll' then (v_item ->> 'widthCm')::integer end,
      case when v_item ->> 'kind' = 'roll' then v_cnt end,
      case when v_item ->> 'kind' = 'roll'
           then (select sum((r ->> 'lengthCm')::integer)::integer from jsonb_array_elements(v_item -> 'rolls') r) end,
      case when v_item ->> 'kind' = 'batch' then (v_item ->> 'quantity')::integer end,
      v_total, v_item ->> 'zeroCostReason', v_line_ext, v_line_dis, v_total + v_line_ext - v_line_dis)
    returning id into v_line_id;
    for v_j in 1 .. v_cnt loop
      v_k := v_k + 1;
      if v_item ->> 'kind' = 'roll' then
        v_seq := nextval('public.roll_lot_seq');
        v_lot_code := 'R-' || case when v_seq < 1000000 then lpad(v_seq::text, 6, '0') else v_seq::text end;
      else
        v_seq := nextval('public.batch_lot_seq');
        v_lot_code := 'B-' || case when v_seq < 1000000 then lpad(v_seq::text, 6, '0') else v_seq::text end;
      end if;
      v_landed := v_bases[v_k] + v_ext[v_k] - v_dis[v_k];
      insert into public.stock_lots (
        lot_code, source_kind, purchase_line_id, lot_sequence, lot_kind, product_id, location_id,
        width_cm_snapshot, initial_length_cm, initial_quantity, base_cost_piastres,
        allocated_extras_piastres, allocated_discount_piastres, landed_cost_piastres, cost_is_estimated, received_on)
      values (
        v_lot_code, 'purchase', v_line_id, v_j, v_item ->> 'kind', (v_item ->> 'productId')::integer, v_old.location_id,
        case when v_item ->> 'kind' = 'roll' then (v_item ->> 'widthCm')::integer end,
        v_lot_len[v_k],
        case when v_item ->> 'kind' = 'batch' then (v_item ->> 'quantity')::integer end,
        v_bases[v_k], v_ext[v_k], v_dis[v_k], v_landed, false, v_old.doc_date)
      returning id into v_lot_id;
      v_lots := v_lots || jsonb_build_array(jsonb_build_object(
        'lotId', v_lot_id, 'lotCode', v_lot_code, 'lineNo', v_i + 1, 'lotSequence', v_j,
        'landedCostPiastres', v_landed));
    end loop;
  end loop;

  for v_i in 0 .. jsonb_array_length(v_charges) - 1 loop
    v_item := v_charges -> v_i;
    insert into public.purchase_doc_charges (doc_id, charge_no, charge_kind, amount_piastres, reference, note)
    values (p_doc_id, v_i + 1, v_item ->> 'kind', (v_item ->> 'amountPiastres')::bigint,
            v_item ->> 'reference', v_item ->> 'note');
  end loop;

  update public.purchase_docs d
     set status = 'posted', draft_payload = null,
         items_subtotal_piastres = v_v, extras_total_piastres = v_e, total_cost_piastres = v_v + v_e - v_d,
         line_count = v_n, charge_count = jsonb_array_length(v_charges), lot_count = v_k,
         supplier_name_snapshot = v_sup_name, location_name_snapshot = v_loc_name,
         posted_at = now(), posted_by = p_actor, version = d.version + 1, updated_at = now(), updated_by = p_actor
   where d.id = p_doc_id
  returning * into v_new;

  if (select coalesce(sum(s.landed_cost_piastres), 0)
        from public.stock_lots s join public.purchase_doc_lines l on l.id = s.purchase_line_id
       where l.doc_id = p_doc_id) <> v_new.total_cost_piastres then
    raise exception 'ZELL_INV_INVARIANT_BROKEN' using detail = 'landed_total';
  end if;

  v_result := jsonb_build_object('docId', v_new.id, 'docNo', v_new.doc_no, 'status', v_new.status,
                                 'version', v_new.version, 'totals', jsonb_build_object(
      'itemsSubtotalPiastres', v_new.items_subtotal_piastres, 'extrasTotalPiastres', v_new.extras_total_piastres,
      'supplierDiscountPiastres', v_new.supplier_discount_piastres, 'totalCostPiastres', v_new.total_cost_piastres), 'lots', v_lots);
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'purchase.post', 'purchase', v_new.id, v_new.version, to_jsonb(v_old), to_jsonb(v_new) || jsonb_build_object('lots', v_lots));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'purchase.post', p_actor, v_hash, 'purchase', v_new.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;

create function public.zell_inv_discard_purchase(p_actor uuid, p_command_id uuid, p_doc_id bigint,
                                                 p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_reason text;
  v_hash text;
  v_replay jsonb;
  v_old public.purchase_docs;
  v_new public.purchase_docs;
  v_result jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  v_reason := nullif(btrim(normalize(p_reason, NFC), E' \t\r\n'), '');
  if v_reason is null then
    null;
  elsif char_length(v_reason) < 1 or char_length(v_reason) > 300 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'reason';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'purchase.discard', 'targetId', p_doc_id, 'expectedVersion', p_expected_version, 'reason', v_reason, 'payload', null::jsonb)::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'purchase.discard', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  select * into v_old from public.purchase_docs d where d.id = p_doc_id for update;
  if not found then
    raise exception 'ZELL_INV_NOT_FOUND' using errcode = '45201', detail = 'docId';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'ZELL_INV_CONFLICT' using errcode = '45202', detail = 'expectedVersion';
  end if;
  if v_old.status <> 'draft' then
    raise exception 'ZELL_INV_NOT_DRAFT' using errcode = '45208', detail = 'status';
  end if;
  update public.purchase_docs d
     set status = 'discarded', discarded_at = now(), discarded_by = p_actor, discard_reason = v_reason,
         version = d.version + 1, updated_at = now(), updated_by = p_actor
   where d.id = p_doc_id
  returning * into v_new;
  v_result := jsonb_build_object('docId', v_new.id, 'docNo', v_new.doc_no, 'status', v_new.status, 'version', v_new.version);
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'purchase.discard', 'purchase', v_new.id, v_new.version, to_jsonb(v_old), to_jsonb(v_new));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'purchase.discard', p_actor, v_hash, 'purchase', v_new.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;

-- §8: الأقفال والفحوص، ثم المستند posted → voided **الأول**، ثم الـlots active → voided.
create function public.zell_inv_void_purchase(p_actor uuid, p_command_id uuid, p_doc_id bigint,
                                              p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_reason text;
  v_hash text;
  v_replay jsonb;
  v_old public.purchase_docs;
  v_new public.purchase_docs;
  v_active integer;
  v_voided integer;
  v_refs text[];
  v_blockers text[];
  v_cnt integer;
  v_lot_ids jsonb;
  v_result jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  v_reason := nullif(btrim(normalize(p_reason, NFC), E' \t\r\n'), '');
  if v_reason is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'reason';
  elsif char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'reason';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'purchase.void', 'targetId', p_doc_id, 'expectedVersion', p_expected_version, 'reason', v_reason, 'payload', null::jsonb)::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'purchase.void', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  select * into v_old from public.purchase_docs d where d.id = p_doc_id for update;
  if not found then
    raise exception 'ZELL_INV_NOT_FOUND' using errcode = '45201', detail = 'docId';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'ZELL_INV_CONFLICT' using errcode = '45202', detail = 'expectedVersion';
  end if;
  if v_old.status <> 'posted' then
    raise exception 'ZELL_INV_NOT_POSTED' using errcode = '45214', detail = 'status';
  end if;
  perform 1
     from public.stock_lots s join public.purchase_doc_lines l on l.id = s.purchase_line_id
    where l.doc_id = p_doc_id
    order by s.id
    for update of s;
  select count(*) filter (where s.status = 'active'), count(*) filter (where s.status = 'voided'),
         coalesce(jsonb_agg(s.id order by s.id), '[]'::jsonb)
    into v_active, v_voided, v_lot_ids
    from public.stock_lots s join public.purchase_doc_lines l on l.id = s.purchase_line_id
   where l.doc_id = p_doc_id;
  if v_active <> v_old.lot_count or v_voided <> 0 then
    raise exception 'ZELL_INV_HAS_DEPENDENCIES' using errcode = '45213', detail = 'lots_state';
  end if;
  v_refs := public.zell_inv_unknown_lot_references();
  if cardinality(v_refs) > 0 then
    raise exception 'ZELL_INV_HAS_DEPENDENCIES' using errcode = '45213', detail = 'unknown_references: ' || array_to_string(v_refs, ', ');
  end if;
  v_blockers := public.zell_inv_doc_void_blockers('purchase', p_doc_id);
  if cardinality(v_blockers) > 0 then
    raise exception 'ZELL_INV_HAS_DEPENDENCIES' using errcode = '45213', detail = 'blockers: ' || array_to_string(v_blockers, ', ');
  end if;
  update public.purchase_docs d
     set status = 'voided', voided_at = now(), voided_by = p_actor, void_reason = v_reason,
         version = d.version + 1, updated_at = now(), updated_by = p_actor
   where d.id = p_doc_id
  returning * into v_new;
  update public.stock_lots s
     set status = 'voided', voided_at = now(), voided_by = p_actor
    from public.purchase_doc_lines l
   where l.id = s.purchase_line_id and l.doc_id = p_doc_id and s.status = 'active';
  get diagnostics v_cnt = row_count;
  if v_cnt <> v_old.lot_count then
    raise exception 'ZELL_INV_INVARIANT_BROKEN' using detail = 'void_lots';
  end if;
  v_result := jsonb_build_object('docId', v_new.id, 'docNo', v_new.doc_no, 'status', v_new.status,
                                 'version', v_new.version, 'voidedLots', v_cnt);
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'purchase.void', 'purchase', v_new.id, v_new.version, to_jsonb(v_old), to_jsonb(v_new) || jsonb_build_object('voidedLotIds', v_lot_ids));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'purchase.void', p_actor, v_hash, 'purchase', v_new.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;


-- (9) RPCs: رصيد أول المدة (أمر مستقل — من غير مورد ولا مصاريف ولا خصم ولا فلوس)
create function public.zell_inv_create_opening(p_actor uuid, p_command_id uuid, p_doc jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_doc jsonb;
  v_hash text;
  v_replay jsonb;
  v_prod jsonb;
  v_item jsonb;
  v_p jsonb;
  v_i integer;
  v_loc_active boolean;
  v_total_all bigint;
  v_total_est bigint;
  v_result jsonb;
  v_seq bigint;
  v_row public.opening_stock_docs;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  v_doc := public.zell_inv_normalize_opening(p_doc);
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'opening.create', 'targetId', null::bigint, 'expectedVersion', null::integer, 'reason', null::text, 'payload', v_doc)::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'opening.create', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  select l.is_active into v_loc_active
    from public.inventory_locations l where l.id = (v_doc ->> 'locationId')::bigint for share;
  if v_loc_active is not true then
    raise exception 'ZELL_INV_LOCATION_INACTIVE' using errcode = '45205', detail = 'locationId';
  end if;
  if (v_doc ->> 'asOfDate')::date > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'ZELL_INV_DATE_IN_FUTURE' using errcode = '45221', detail = 'asOfDate';
  end if;
  select coalesce(jsonb_object_agg(r.product_id::text, jsonb_build_object('name', r.name_ar, 'unit', r.sale_unit, 'base', r.base_width_cm, 'widths', to_jsonb(r.active_widths))), '{}'::jsonb)
    into v_prod
    from public.zell_inv_read_products(array(select distinct (e ->> 'productId')::integer from jsonb_array_elements(v_doc -> 'lines') e order by 1)) r;
  for v_i in 0 .. jsonb_array_length(v_doc -> 'lines') - 1 loop
    v_item := v_doc -> 'lines' -> v_i;
    v_p := v_prod -> (v_item ->> 'productId');
    if v_p is null or (v_p ->> 'unit') is distinct from (case when v_item ->> 'kind' = 'roll' then 'meter' else 'piece' end) then
      raise exception 'ZELL_INV_PRODUCT_UNIT' using errcode = '45206', detail = 'lines[' || v_i || '].productId';
    end if;
    if v_item ->> 'kind' = 'roll' then
      if not public.zell_inv_width_allowed((v_p ->> 'base')::integer,
                                           array(select x::integer from jsonb_array_elements_text(v_p -> 'widths') x),
                                           (v_item ->> 'widthCm')::integer) then
        raise exception 'ZELL_INV_WIDTH_NOT_ALLOWED' using errcode = '45207', detail = 'lines[' || v_i || '].widthCm';
      end if;
    end if;
  end loop;
  select coalesce(sum((e ->> 'lineTotalPiastres')::bigint), 0),
         coalesce(sum((e ->> 'lineTotalPiastres')::bigint) filter (where (e ->> 'costIsEstimated')::boolean), 0)
    into v_total_all, v_total_est
    from jsonb_array_elements(v_doc -> 'lines') e;
  v_seq := nextval('public.opening_doc_no_seq');
  insert into public.opening_stock_docs (
    doc_no, status, location_id, as_of_date, note, draft_payload, items_total_piastres, estimated_total_piastres,
    line_count, created_by, updated_by)
  values (
    'OPN-' || case when v_seq < 1000000 then lpad(v_seq::text, 6, '0') else v_seq::text end, 'draft', (v_doc ->> 'locationId')::bigint, (v_doc ->> 'asOfDate')::date,
    v_doc ->> 'note', v_doc, v_total_all, v_total_est, jsonb_array_length(v_doc -> 'lines'), p_actor, p_actor)
  returning * into v_row;
  v_result := jsonb_build_object('docId', v_row.id, 'docNo', v_row.doc_no, 'status', v_row.status,
                                 'version', v_row.version, 'totals', jsonb_build_object('itemsTotalPiastres', v_row.items_total_piastres, 'estimatedTotalPiastres', v_row.estimated_total_piastres));
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'opening.create', 'opening', v_row.id, v_row.version, null::jsonb, to_jsonb(v_row));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'opening.create', p_actor, v_hash, 'opening', v_row.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;

create function public.zell_inv_update_opening(p_actor uuid, p_command_id uuid, p_doc_id bigint,
                                               p_expected_version integer, p_doc jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_doc jsonb;
  v_hash text;
  v_replay jsonb;
  v_prod jsonb;
  v_item jsonb;
  v_p jsonb;
  v_i integer;
  v_loc_active boolean;
  v_total_all bigint;
  v_total_est bigint;
  v_result jsonb;
  v_old public.opening_stock_docs;
  v_new public.opening_stock_docs;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  v_doc := public.zell_inv_normalize_opening(p_doc);
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'opening.update', 'targetId', p_doc_id, 'expectedVersion', p_expected_version, 'reason', null::text, 'payload', v_doc)::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'opening.update', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  select * into v_old from public.opening_stock_docs d where d.id = p_doc_id for update;
  if not found then
    raise exception 'ZELL_INV_NOT_FOUND' using errcode = '45201', detail = 'docId';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'ZELL_INV_CONFLICT' using errcode = '45202', detail = 'expectedVersion';
  end if;
  if v_old.status <> 'draft' then
    raise exception 'ZELL_INV_NOT_DRAFT' using errcode = '45208', detail = 'status';
  end if;
  select l.is_active into v_loc_active
    from public.inventory_locations l where l.id = (v_doc ->> 'locationId')::bigint for share;
  if v_loc_active is not true then
    raise exception 'ZELL_INV_LOCATION_INACTIVE' using errcode = '45205', detail = 'locationId';
  end if;
  if (v_doc ->> 'asOfDate')::date > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'ZELL_INV_DATE_IN_FUTURE' using errcode = '45221', detail = 'asOfDate';
  end if;
  select coalesce(jsonb_object_agg(r.product_id::text, jsonb_build_object('name', r.name_ar, 'unit', r.sale_unit, 'base', r.base_width_cm, 'widths', to_jsonb(r.active_widths))), '{}'::jsonb)
    into v_prod
    from public.zell_inv_read_products(array(select distinct (e ->> 'productId')::integer from jsonb_array_elements(v_doc -> 'lines') e order by 1)) r;
  for v_i in 0 .. jsonb_array_length(v_doc -> 'lines') - 1 loop
    v_item := v_doc -> 'lines' -> v_i;
    v_p := v_prod -> (v_item ->> 'productId');
    if v_p is null or (v_p ->> 'unit') is distinct from (case when v_item ->> 'kind' = 'roll' then 'meter' else 'piece' end) then
      raise exception 'ZELL_INV_PRODUCT_UNIT' using errcode = '45206', detail = 'lines[' || v_i || '].productId';
    end if;
    if v_item ->> 'kind' = 'roll' then
      if not public.zell_inv_width_allowed((v_p ->> 'base')::integer,
                                           array(select x::integer from jsonb_array_elements_text(v_p -> 'widths') x),
                                           (v_item ->> 'widthCm')::integer) then
        raise exception 'ZELL_INV_WIDTH_NOT_ALLOWED' using errcode = '45207', detail = 'lines[' || v_i || '].widthCm';
      end if;
    end if;
  end loop;
  select coalesce(sum((e ->> 'lineTotalPiastres')::bigint), 0),
         coalesce(sum((e ->> 'lineTotalPiastres')::bigint) filter (where (e ->> 'costIsEstimated')::boolean), 0)
    into v_total_all, v_total_est
    from jsonb_array_elements(v_doc -> 'lines') e;
  update public.opening_stock_docs d
     set location_id = (v_doc ->> 'locationId')::bigint, as_of_date = (v_doc ->> 'asOfDate')::date,
         note = v_doc ->> 'note', draft_payload = v_doc,
         items_total_piastres = v_total_all, estimated_total_piastres = v_total_est,
         line_count = jsonb_array_length(v_doc -> 'lines'),
         version = d.version + 1, updated_at = now(), updated_by = p_actor
   where d.id = p_doc_id
  returning * into v_new;
  v_result := jsonb_build_object('docId', v_new.id, 'docNo', v_new.doc_no, 'status', v_new.status,
                                 'version', v_new.version, 'totals', jsonb_build_object('itemsTotalPiastres', v_new.items_total_piastres, 'estimatedTotalPiastres', v_new.estimated_total_piastres));
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'opening.update', 'opening', v_new.id, v_new.version, to_jsonb(v_old), to_jsonb(v_new));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'opening.update', p_actor, v_hash, 'opening', v_new.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;

create function public.zell_inv_post_opening(p_actor uuid, p_command_id uuid, p_doc_id bigint, p_expected_version integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_hash text;
  v_replay jsonb;
  v_old public.opening_stock_docs;
  v_new public.opening_stock_docs;
  v_doc jsonb;
  v_lines jsonb;
  v_item jsonb;
  v_p jsonb;
  v_prod jsonb;
  v_loc_active boolean;
  v_loc_name text;
  v_i integer;
  v_j integer;
  v_k integer;
  v_n integer;
  v_cnt integer;
  v_total bigint;
  v_total_all bigint;
  v_total_est bigint;
  v_estimated boolean;
  v_lens bigint[];
  v_bases bigint[];
  v_line_id bigint;
  v_lot_id bigint;
  v_lot_code text;
  v_seq bigint;
  v_lots jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'opening.post', 'targetId', p_doc_id, 'expectedVersion', p_expected_version, 'reason', null::text, 'payload', null::jsonb)::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'opening.post', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  select * into v_old from public.opening_stock_docs d where d.id = p_doc_id for update;
  if not found then
    raise exception 'ZELL_INV_NOT_FOUND' using errcode = '45201', detail = 'docId';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'ZELL_INV_CONFLICT' using errcode = '45202', detail = 'expectedVersion';
  end if;
  if v_old.status <> 'draft' then
    raise exception 'ZELL_INV_NOT_DRAFT' using errcode = '45208', detail = 'status';
  end if;
  v_doc := v_old.draft_payload;
  v_lines := v_doc -> 'lines';
  v_n := jsonb_array_length(v_lines);
  if v_n = 0 then
    raise exception 'ZELL_INV_EMPTY' using errcode = '45209', detail = 'lines';
  end if;
  select l.is_active, l.name into v_loc_active, v_loc_name
    from public.inventory_locations l where l.id = v_old.location_id for share;
  if v_loc_active is not true then
    raise exception 'ZELL_INV_LOCATION_INACTIVE' using errcode = '45205', detail = 'locationId';
  end if;
  if v_old.as_of_date > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'ZELL_INV_DATE_IN_FUTURE' using errcode = '45221', detail = 'asOfDate';
  end if;
  select coalesce(jsonb_object_agg(r.product_id::text, jsonb_build_object('name', r.name_ar, 'unit', r.sale_unit, 'base', r.base_width_cm, 'widths', to_jsonb(r.active_widths))), '{}'::jsonb)
    into v_prod
    from public.zell_inv_lock_products(array(select distinct (e ->> 'productId')::integer from jsonb_array_elements(v_lines) e order by 1)) r;
  for v_i in 0 .. jsonb_array_length(v_lines) - 1 loop
    v_item := v_lines -> v_i;
    v_p := v_prod -> (v_item ->> 'productId');
    if v_p is null or (v_p ->> 'unit') is distinct from (case when v_item ->> 'kind' = 'roll' then 'meter' else 'piece' end) then
      raise exception 'ZELL_INV_PRODUCT_UNIT' using errcode = '45206', detail = 'lines[' || v_i || '].productId';
    end if;
    if v_item ->> 'kind' = 'roll' then
      if not public.zell_inv_width_allowed((v_p ->> 'base')::integer,
                                           array(select x::integer from jsonb_array_elements_text(v_p -> 'widths') x),
                                           (v_item ->> 'widthCm')::integer) then
        raise exception 'ZELL_INV_WIDTH_NOT_ALLOWED' using errcode = '45207', detail = 'lines[' || v_i || '].widthCm';
      end if;
    end if;
  end loop;
  select coalesce(sum((e ->> 'lineTotalPiastres')::bigint), 0),
         coalesce(sum((e ->> 'lineTotalPiastres')::bigint) filter (where (e ->> 'costIsEstimated')::boolean), 0)
    into v_total_all, v_total_est
    from jsonb_array_elements(v_lines) e;

  v_k := 0;
  for v_i in 0 .. v_n - 1 loop
    v_item := v_lines -> v_i;
    v_p := v_prod -> (v_item ->> 'productId');
    v_total := (v_item ->> 'lineTotalPiastres')::bigint;
    v_estimated := (v_item ->> 'costIsEstimated')::boolean;
    if v_item ->> 'kind' = 'roll' then
      v_lens := array(select (r.value ->> 'lengthCm')::bigint
                        from jsonb_array_elements(v_item -> 'rolls') with ordinality as r(value, ord)
                       order by r.ord);
      v_bases := public.zell_inv_allocate_lr(v_total, v_lens);
      v_cnt := array_length(v_lens, 1);
    else
      v_lens := array[null::bigint];
      v_bases := array[v_total];
      v_cnt := 1;
    end if;
    insert into public.opening_stock_lines (
      doc_id, line_no, line_kind, product_id, product_name_snapshot, sale_unit_snapshot, width_cm_snapshot,
      roll_count, total_length_cm, quantity, line_total_piastres, zero_cost_reason, cost_is_estimated, estimate_note)
    values (
      p_doc_id, v_i + 1, v_item ->> 'kind', (v_item ->> 'productId')::integer,
      left(coalesce(nullif(btrim(v_p ->> 'name'), ''), 'منتج #' || (v_item ->> 'productId')), 200),
      v_p ->> 'unit',
      case when v_item ->> 'kind' = 'roll' then (v_item ->> 'widthCm')::integer end,
      case when v_item ->> 'kind' = 'roll' then v_cnt end,
      case when v_item ->> 'kind' = 'roll'
           then (select sum((r ->> 'lengthCm')::integer)::integer from jsonb_array_elements(v_item -> 'rolls') r) end,
      case when v_item ->> 'kind' = 'batch' then (v_item ->> 'quantity')::integer end,
      v_total, v_item ->> 'zeroCostReason', v_estimated, v_item ->> 'estimateNote')
    returning id into v_line_id;
    for v_j in 1 .. v_cnt loop
      v_k := v_k + 1;
      if v_item ->> 'kind' = 'roll' then
        v_seq := nextval('public.roll_lot_seq');
        v_lot_code := 'R-' || case when v_seq < 1000000 then lpad(v_seq::text, 6, '0') else v_seq::text end;
      else
        v_seq := nextval('public.batch_lot_seq');
        v_lot_code := 'B-' || case when v_seq < 1000000 then lpad(v_seq::text, 6, '0') else v_seq::text end;
      end if;
      insert into public.stock_lots (
        lot_code, source_kind, opening_line_id, lot_sequence, lot_kind, product_id, location_id,
        width_cm_snapshot, initial_length_cm, initial_quantity, base_cost_piastres,
        allocated_extras_piastres, allocated_discount_piastres, landed_cost_piastres, cost_is_estimated, received_on)
      values (
        v_lot_code, 'opening', v_line_id, v_j, v_item ->> 'kind', (v_item ->> 'productId')::integer, v_old.location_id,
        case when v_item ->> 'kind' = 'roll' then (v_item ->> 'widthCm')::integer end,
        v_lens[v_j]::integer,
        case when v_item ->> 'kind' = 'batch' then (v_item ->> 'quantity')::integer end,
        v_bases[v_j], 0, 0, v_bases[v_j], v_estimated, v_old.as_of_date)
      returning id into v_lot_id;
      v_lots := v_lots || jsonb_build_array(jsonb_build_object(
        'lotId', v_lot_id, 'lotCode', v_lot_code, 'lineNo', v_i + 1, 'lotSequence', v_j,
        'landedCostPiastres', v_bases[v_j], 'costIsEstimated', v_estimated));
    end loop;
  end loop;

  update public.opening_stock_docs d
     set status = 'posted', draft_payload = null,
         items_total_piastres = v_total_all, estimated_total_piastres = v_total_est,
         line_count = v_n, lot_count = v_k, location_name_snapshot = v_loc_name,
         posted_at = now(), posted_by = p_actor, version = d.version + 1, updated_at = now(), updated_by = p_actor
   where d.id = p_doc_id
  returning * into v_new;

  if (select coalesce(sum(s.landed_cost_piastres), 0)
        from public.stock_lots s join public.opening_stock_lines l on l.id = s.opening_line_id
       where l.doc_id = p_doc_id) <> v_new.items_total_piastres then
    raise exception 'ZELL_INV_INVARIANT_BROKEN' using detail = 'opening_total';
  end if;

  v_result := jsonb_build_object('docId', v_new.id, 'docNo', v_new.doc_no, 'status', v_new.status,
                                 'version', v_new.version, 'totals', jsonb_build_object('itemsTotalPiastres', v_new.items_total_piastres, 'estimatedTotalPiastres', v_new.estimated_total_piastres), 'lots', v_lots);
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'opening.post', 'opening', v_new.id, v_new.version, to_jsonb(v_old), to_jsonb(v_new) || jsonb_build_object('lots', v_lots));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'opening.post', p_actor, v_hash, 'opening', v_new.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;

create function public.zell_inv_discard_opening(p_actor uuid, p_command_id uuid, p_doc_id bigint,
                                                p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_reason text;
  v_hash text;
  v_replay jsonb;
  v_old public.opening_stock_docs;
  v_new public.opening_stock_docs;
  v_result jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  v_reason := nullif(btrim(normalize(p_reason, NFC), E' \t\r\n'), '');
  if v_reason is null then
    null;
  elsif char_length(v_reason) < 1 or char_length(v_reason) > 300 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'reason';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'opening.discard', 'targetId', p_doc_id, 'expectedVersion', p_expected_version, 'reason', v_reason, 'payload', null::jsonb)::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'opening.discard', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  select * into v_old from public.opening_stock_docs d where d.id = p_doc_id for update;
  if not found then
    raise exception 'ZELL_INV_NOT_FOUND' using errcode = '45201', detail = 'docId';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'ZELL_INV_CONFLICT' using errcode = '45202', detail = 'expectedVersion';
  end if;
  if v_old.status <> 'draft' then
    raise exception 'ZELL_INV_NOT_DRAFT' using errcode = '45208', detail = 'status';
  end if;
  update public.opening_stock_docs d
     set status = 'discarded', discarded_at = now(), discarded_by = p_actor, discard_reason = v_reason,
         version = d.version + 1, updated_at = now(), updated_by = p_actor
   where d.id = p_doc_id
  returning * into v_new;
  v_result := jsonb_build_object('docId', v_new.id, 'docNo', v_new.doc_no, 'status', v_new.status, 'version', v_new.version);
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'opening.discard', 'opening', v_new.id, v_new.version, to_jsonb(v_old), to_jsonb(v_new));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'opening.discard', p_actor, v_hash, 'opening', v_new.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;

create function public.zell_inv_void_opening(p_actor uuid, p_command_id uuid, p_doc_id bigint,
                                             p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_reason text;
  v_hash text;
  v_replay jsonb;
  v_old public.opening_stock_docs;
  v_new public.opening_stock_docs;
  v_active integer;
  v_voided integer;
  v_refs text[];
  v_blockers text[];
  v_cnt integer;
  v_lot_ids jsonb;
  v_result jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  if p_command_id is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'commandId';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zell_inv:' || p_command_id::text, 0));
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  v_reason := nullif(btrim(normalize(p_reason, NFC), E' \t\r\n'), '');
  if v_reason is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'reason';
  elsif char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'reason';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('v', 1, 'kind', 'opening.void', 'targetId', p_doc_id, 'expectedVersion', p_expected_version, 'reason', v_reason, 'payload', null::jsonb)::text, 'UTF8')), 'hex');
  v_replay := public.zell_inv_command_check(p_actor, p_command_id, 'opening.void', v_hash);
  if v_replay is not null then
    return v_replay;
  end if;
  if p_doc_id is null or p_expected_version is null then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'docId';
  end if;
  select * into v_old from public.opening_stock_docs d where d.id = p_doc_id for update;
  if not found then
    raise exception 'ZELL_INV_NOT_FOUND' using errcode = '45201', detail = 'docId';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'ZELL_INV_CONFLICT' using errcode = '45202', detail = 'expectedVersion';
  end if;
  if v_old.status <> 'posted' then
    raise exception 'ZELL_INV_NOT_POSTED' using errcode = '45214', detail = 'status';
  end if;
  perform 1
     from public.stock_lots s join public.opening_stock_lines l on l.id = s.opening_line_id
    where l.doc_id = p_doc_id
    order by s.id
    for update of s;
  select count(*) filter (where s.status = 'active'), count(*) filter (where s.status = 'voided'),
         coalesce(jsonb_agg(s.id order by s.id), '[]'::jsonb)
    into v_active, v_voided, v_lot_ids
    from public.stock_lots s join public.opening_stock_lines l on l.id = s.opening_line_id
   where l.doc_id = p_doc_id;
  if v_active <> v_old.lot_count or v_voided <> 0 then
    raise exception 'ZELL_INV_HAS_DEPENDENCIES' using errcode = '45213', detail = 'lots_state';
  end if;
  v_refs := public.zell_inv_unknown_lot_references();
  if cardinality(v_refs) > 0 then
    raise exception 'ZELL_INV_HAS_DEPENDENCIES' using errcode = '45213', detail = 'unknown_references: ' || array_to_string(v_refs, ', ');
  end if;
  v_blockers := public.zell_inv_doc_void_blockers('opening', p_doc_id);
  if cardinality(v_blockers) > 0 then
    raise exception 'ZELL_INV_HAS_DEPENDENCIES' using errcode = '45213', detail = 'blockers: ' || array_to_string(v_blockers, ', ');
  end if;
  update public.opening_stock_docs d
     set status = 'voided', voided_at = now(), voided_by = p_actor, void_reason = v_reason,
         version = d.version + 1, updated_at = now(), updated_by = p_actor
   where d.id = p_doc_id
  returning * into v_new;
  update public.stock_lots s
     set status = 'voided', voided_at = now(), voided_by = p_actor
    from public.opening_stock_lines l
   where l.id = s.opening_line_id and l.doc_id = p_doc_id and s.status = 'active';
  get diagnostics v_cnt = row_count;
  if v_cnt <> v_old.lot_count then
    raise exception 'ZELL_INV_INVARIANT_BROKEN' using detail = 'void_lots';
  end if;
  v_result := jsonb_build_object('docId', v_new.id, 'docNo', v_new.doc_no, 'status', v_new.status,
                                 'version', v_new.version, 'voidedLots', v_cnt);
  insert into public.inventory_audit_log (actor_user_id, command_id, action, entity_type, entity_id, version_after, "before", "after")
  values (p_actor, p_command_id, 'opening.void', 'opening', v_new.id, v_new.version, to_jsonb(v_old), to_jsonb(v_new) || jsonb_build_object('voidedLotIds', v_lot_ids));
  insert into public.inventory_commands (command_id, command_kind, actor_user_id, request_hash, target_type, target_id, result)
  values (p_command_id, 'opening.void', p_actor, v_hash, 'opening', v_new.id, v_result)
  on conflict (command_id) do nothing;
  if not found then
    raise exception 'ZELL_INV_COMMAND_RACE' using errcode = '45222';
  end if;
  return v_result;
end
$fn$;


-- (10) RPCs: القراءة (owner بس). keyset pagination، افتراضي 25 وأقصى 100، ومفيش SELECT *.
create function public.zell_inv_list_locations(p_actor uuid, p_include_inactive boolean, p_limit integer, p_after_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer;
  v_after bigint := coalesce(p_after_id, 0);
  v_ids bigint[];
  v_items jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  v_limit := coalesce(p_limit, 25);
  if v_limit < 1 or v_limit > 100 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'limit';
  end if;
  if coalesce(p_include_inactive, false) then
    v_ids := array(select l.id from public.inventory_locations l
                    where l.id > v_after order by l.id limit v_limit);
  else
    v_ids := array(select l.id from public.inventory_locations l
                    where l.is_active and l.id > v_after order by l.id limit v_limit);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'locationId', l.id, 'code', l.code, 'name', l.name, 'isDefault', l.is_default,
           'isActive', l.is_active, 'version', l.version, 'updatedAt', l.updated_at) order by l.id), '[]'::jsonb)
    into v_items
    from public.inventory_locations l where l.id = any (v_ids);
  return jsonb_build_object('items', v_items,
                            'nextAfterId', case when cardinality(v_ids) = v_limit then v_ids[v_limit] end);
end
$fn$;

create function public.zell_inv_list_suppliers(p_actor uuid, p_include_inactive boolean, p_limit integer, p_after_name_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer;
  v_after text := coalesce(p_after_name_key, '');
  v_keys text[];
  v_items jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  v_limit := coalesce(p_limit, 25);
  if v_limit < 1 or v_limit > 100 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'limit';
  end if;
  if coalesce(p_include_inactive, false) then
    v_keys := array(select s.name_key from public.suppliers s
                     where s.name_key > v_after order by s.name_key limit v_limit);
  else
    v_keys := array(select s.name_key from public.suppliers s
                     where s.is_active and s.name_key > v_after order by s.name_key limit v_limit);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'supplierId', s.id, 'name', s.name, 'phone', s.phone, 'note', s.note, 'isActive', s.is_active,
           'version', s.version, 'updatedAt', s.updated_at) order by s.name_key), '[]'::jsonb)
    into v_items
    from public.suppliers s where s.name_key = any (v_keys);
  return jsonb_build_object('items', v_items,
                            'nextAfterNameKey', case when cardinality(v_keys) = v_limit then v_keys[v_limit] end);
end
$fn$;

create function public.zell_inv_list_purchases(p_actor uuid, p_status text, p_supplier_id bigint, p_limit integer, p_before_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer;
  v_before bigint := coalesce(p_before_id, 9223372036854775807);
  v_ids bigint[];
  v_items jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  v_limit := coalesce(p_limit, 25);
  if v_limit < 1 or v_limit > 100 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'limit';
  end if;
  if p_status is not null and p_status not in ('draft', 'posted', 'voided', 'discarded') then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'status';
  end if;
  if p_status is null and p_supplier_id is null then
    v_ids := array(select d.id from public.purchase_docs d
                    where d.id < v_before order by d.id desc limit v_limit);
  elsif p_supplier_id is null then
    v_ids := array(select d.id from public.purchase_docs d
                    where d.status = p_status and d.id < v_before order by d.id desc limit v_limit);
  elsif p_status is null then
    v_ids := array(select d.id from public.purchase_docs d
                    where d.supplier_id = p_supplier_id and d.id < v_before order by d.id desc limit v_limit);
  else
    v_ids := array(select d.id from public.purchase_docs d
                    where d.supplier_id = p_supplier_id and d.status = p_status and d.id < v_before
                    order by d.id desc limit v_limit);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'docId', d.id, 'docNo', d.doc_no, 'status', d.status,
      'supplierId', d.supplier_id, 'supplierName', coalesce(d.supplier_name_snapshot, s.name),
      'supplierRef', d.supplier_ref, 'locationId', d.location_id,
      'locationName', coalesce(d.location_name_snapshot, l.name), 'docDate', d.doc_date, 'note', d.note,
      'supplierDiscountPiastres', d.supplier_discount_piastres, 'itemsSubtotalPiastres', d.items_subtotal_piastres,
      'extrasTotalPiastres', d.extras_total_piastres, 'totalCostPiastres', d.total_cost_piastres,
      'lineCount', d.line_count, 'chargeCount', d.charge_count, 'lotCount', d.lot_count,
      'postedAt', d.posted_at, 'voidedAt', d.voided_at, 'voidReason', d.void_reason,
      'discardedAt', d.discarded_at, 'discardReason', d.discard_reason,
      'version', d.version, 'updatedAt', d.updated_at) order by d.id desc), '[]'::jsonb)
    into v_items
    from public.purchase_docs d
    left join public.suppliers s on s.id = d.supplier_id
    join public.inventory_locations l on l.id = d.location_id
   where d.id = any (v_ids);
  return jsonb_build_object('items', v_items,
                            'nextBeforeId', case when cardinality(v_ids) = v_limit then v_ids[v_limit] end);
end
$fn$;

create function public.zell_inv_get_purchase(p_actor uuid, p_doc_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_header jsonb;
  v_status text;
  v_payload jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_charges jsonb := '[]'::jsonb;
  v_lots jsonb := '[]'::jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  select jsonb_build_object(
      'docId', d.id, 'docNo', d.doc_no, 'status', d.status,
      'supplierId', d.supplier_id, 'supplierName', coalesce(d.supplier_name_snapshot, s.name),
      'supplierRef', d.supplier_ref, 'locationId', d.location_id,
      'locationName', coalesce(d.location_name_snapshot, l.name), 'docDate', d.doc_date, 'note', d.note,
      'supplierDiscountPiastres', d.supplier_discount_piastres, 'itemsSubtotalPiastres', d.items_subtotal_piastres,
      'extrasTotalPiastres', d.extras_total_piastres, 'totalCostPiastres', d.total_cost_piastres,
      'lineCount', d.line_count, 'chargeCount', d.charge_count, 'lotCount', d.lot_count,
      'postedAt', d.posted_at, 'voidedAt', d.voided_at, 'voidReason', d.void_reason,
      'discardedAt', d.discarded_at, 'discardReason', d.discard_reason,
      'version', d.version, 'updatedAt', d.updated_at), d.status, d.draft_payload
    into v_header, v_status, v_payload
    from public.purchase_docs d
    left join public.suppliers s on s.id = d.supplier_id
    join public.inventory_locations l on l.id = d.location_id
   where d.id = p_doc_id;
  if not found then
    raise exception 'ZELL_INV_NOT_FOUND' using errcode = '45201', detail = 'docId';
  end if;
  if v_status in ('posted', 'voided') then
    select coalesce(jsonb_agg(jsonb_build_object('lineId', x.id, 'lineNo', x.line_no, 'kind', x.line_kind,
      'productId', x.product_id, 'productName', x.product_name_snapshot, 'saleUnit', x.sale_unit_snapshot,
      'widthCm', x.width_cm_snapshot, 'rollCount', x.roll_count, 'totalLengthCm', x.total_length_cm,
      'quantity', x.quantity, 'lineTotalPiastres', x.line_total_piastres, 'zeroCostReason', x.zero_cost_reason,
             'allocatedExtrasPiastres', x.allocated_extras_piastres,
             'allocatedDiscountPiastres', x.allocated_discount_piastres,
             'landedTotalPiastres', x.landed_total_piastres) order by x.line_no), '[]'::jsonb)
      into v_lines
      from public.purchase_doc_lines x where x.doc_id = p_doc_id;
    select coalesce(jsonb_agg(jsonb_build_object(
             'chargeNo', c.charge_no, 'kind', c.charge_kind, 'amountPiastres', c.amount_piastres,
             'reference', c.reference, 'note', c.note) order by c.charge_no), '[]'::jsonb)
      into v_charges
      from public.purchase_doc_charges c where c.doc_id = p_doc_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'lotId', s.id, 'lotCode', s.lot_code, 'sourceKind', s.source_kind, 'lotKind', s.lot_kind,
      'lotSequence', s.lot_sequence, 'productId', s.product_id, 'locationId', s.location_id,
      'widthCm', s.width_cm_snapshot, 'initialLengthCm', s.initial_length_cm, 'initialQuantity', s.initial_quantity,
      'baseCostPiastres', s.base_cost_piastres, 'allocatedExtrasPiastres', s.allocated_extras_piastres,
      'allocatedDiscountPiastres', s.allocated_discount_piastres, 'landedCostPiastres', s.landed_cost_piastres,
      'costIsEstimated', s.cost_is_estimated, 'receivedOn', s.received_on, 'status', s.status, 'voidedAt', s.voided_at) || jsonb_build_object('lineNo', x.line_no) order by x.line_no, s.lot_sequence), '[]'::jsonb)
      into v_lots
      from public.stock_lots s join public.purchase_doc_lines x on x.id = s.purchase_line_id
     where x.doc_id = p_doc_id;
  end if;
  return jsonb_build_object('header', v_header, 'draftPayload', v_payload,
                            'lines', v_lines, 'charges', v_charges, 'lots', v_lots);
end
$fn$;

create function public.zell_inv_preview_purchase(p_actor uuid, p_doc jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_doc jsonb;
  v_prod jsonb;
  v_item jsonb;
  v_p jsonb;
  v_i integer;
  v_j integer;
  v_total bigint;
  v_v bigint;
  v_e bigint;
  v_d bigint;
  v_lens bigint[];
  v_bases bigint[];
  v_lot_line integer[];
  v_lot_seq integer[];
  v_ext bigint[];
  v_dis bigint[];
  v_out jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  v_doc := public.zell_inv_normalize_purchase(p_doc);
  select coalesce(jsonb_object_agg(r.product_id::text, jsonb_build_object('name', r.name_ar, 'unit', r.sale_unit, 'base', r.base_width_cm, 'widths', to_jsonb(r.active_widths))), '{}'::jsonb)
    into v_prod
    from public.zell_inv_read_products(array(select distinct (e ->> 'productId')::integer from jsonb_array_elements(v_doc -> 'lines') e order by 1)) r;
  for v_i in 0 .. jsonb_array_length(v_doc -> 'lines') - 1 loop
    v_item := v_doc -> 'lines' -> v_i;
    v_p := v_prod -> (v_item ->> 'productId');
    if v_p is null or (v_p ->> 'unit') is distinct from (case when v_item ->> 'kind' = 'roll' then 'meter' else 'piece' end) then
      raise exception 'ZELL_INV_PRODUCT_UNIT' using errcode = '45206', detail = 'lines[' || v_i || '].productId';
    end if;
    if v_item ->> 'kind' = 'roll' then
      if not public.zell_inv_width_allowed((v_p ->> 'base')::integer,
                                           array(select x::integer from jsonb_array_elements_text(v_p -> 'widths') x),
                                           (v_item ->> 'widthCm')::integer) then
        raise exception 'ZELL_INV_WIDTH_NOT_ALLOWED' using errcode = '45207', detail = 'lines[' || v_i || '].widthCm';
      end if;
    end if;
  end loop;
  v_bases := '{}';
  v_lot_line := '{}';
  v_lot_seq := '{}';
  for v_i in 0 .. jsonb_array_length(v_doc -> 'lines') - 1 loop
    v_item := (v_doc -> 'lines') -> v_i;
    v_total := (v_item ->> 'lineTotalPiastres')::bigint;
    if v_item ->> 'kind' = 'roll' then
      v_lens := array(select (r.value ->> 'lengthCm')::bigint
                        from jsonb_array_elements(v_item -> 'rolls') with ordinality as r(value, ord)
                       order by r.ord);
      v_bases := v_bases || public.zell_inv_allocate_lr(v_total, v_lens);
      v_lot_line := v_lot_line || array_fill(v_i + 1, array[array_length(v_lens, 1)]);
      v_lot_seq := v_lot_seq || array(select g from generate_series(1, array_length(v_lens, 1)) g);
    else
      v_bases := v_bases || v_total;
      v_lot_line := v_lot_line || (v_i + 1);
      v_lot_seq := v_lot_seq || 1;
    end if;
  end loop;
  select coalesce(sum((e ->> 'lineTotalPiastres')::bigint), 0) into v_v from jsonb_array_elements(v_doc -> 'lines') e;
  select coalesce(sum((e ->> 'amountPiastres')::bigint), 0) into v_e from jsonb_array_elements(v_doc -> 'charges') e;
  v_d := (v_doc ->> 'supplierDiscountPiastres')::bigint;
  if (v_e > 0 or v_d > 0) and v_v = 0 then
    raise exception 'ZELL_INV_ALLOCATION_BASE_ZERO' using errcode = '45210', detail = 'lines';
  end if;
  if v_d > 0 and v_d >= v_v then
    raise exception 'ZELL_INV_DISCOUNT_TOO_LARGE' using errcode = '45211', detail = 'supplierDiscountPiastres';
  end if;
  v_ext := public.zell_inv_allocate_lr(v_e, v_bases);
  v_dis := public.zell_inv_allocate_lr(v_d, v_bases);
  v_out := '[]'::jsonb;
  for v_j in 1 .. coalesce(array_length(v_bases, 1), 0) loop
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'lineNo', v_lot_line[v_j], 'lotSequence', v_lot_seq[v_j], 'baseCostPiastres', v_bases[v_j],
      'allocatedExtrasPiastres', v_ext[v_j], 'allocatedDiscountPiastres', v_dis[v_j],
      'landedCostPiastres', v_bases[v_j] + v_ext[v_j] - v_dis[v_j]));
  end loop;
  return jsonb_build_object(
    'totals', jsonb_build_object('itemsSubtotalPiastres', v_v, 'extrasTotalPiastres', v_e,
                                 'supplierDiscountPiastres', v_d, 'totalCostPiastres', v_v + v_e - v_d),
    'lots', v_out);
end
$fn$;

create function public.zell_inv_list_openings(p_actor uuid, p_status text, p_limit integer, p_before_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer;
  v_before bigint := coalesce(p_before_id, 9223372036854775807);
  v_ids bigint[];
  v_items jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  v_limit := coalesce(p_limit, 25);
  if v_limit < 1 or v_limit > 100 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'limit';
  end if;
  if p_status is not null and p_status not in ('draft', 'posted', 'voided', 'discarded') then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'status';
  end if;
  if p_status is null then
    v_ids := array(select d.id from public.opening_stock_docs d
                    where d.id < v_before order by d.id desc limit v_limit);
  else
    v_ids := array(select d.id from public.opening_stock_docs d
                    where d.status = p_status and d.id < v_before order by d.id desc limit v_limit);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'docId', d.id, 'docNo', d.doc_no, 'status', d.status, 'locationId', d.location_id,
      'locationName', coalesce(d.location_name_snapshot, l.name), 'asOfDate', d.as_of_date, 'note', d.note,
      'itemsTotalPiastres', d.items_total_piastres, 'estimatedTotalPiastres', d.estimated_total_piastres,
      'lineCount', d.line_count, 'lotCount', d.lot_count,
      'postedAt', d.posted_at, 'voidedAt', d.voided_at, 'voidReason', d.void_reason,
      'discardedAt', d.discarded_at, 'discardReason', d.discard_reason,
      'version', d.version, 'updatedAt', d.updated_at) order by d.id desc), '[]'::jsonb)
    into v_items
    from public.opening_stock_docs d
    join public.inventory_locations l on l.id = d.location_id
   where d.id = any (v_ids);
  return jsonb_build_object('items', v_items,
                            'nextBeforeId', case when cardinality(v_ids) = v_limit then v_ids[v_limit] end);
end
$fn$;

create function public.zell_inv_get_opening(p_actor uuid, p_doc_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_header jsonb;
  v_status text;
  v_payload jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_lots jsonb := '[]'::jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  select jsonb_build_object(
      'docId', d.id, 'docNo', d.doc_no, 'status', d.status, 'locationId', d.location_id,
      'locationName', coalesce(d.location_name_snapshot, l.name), 'asOfDate', d.as_of_date, 'note', d.note,
      'itemsTotalPiastres', d.items_total_piastres, 'estimatedTotalPiastres', d.estimated_total_piastres,
      'lineCount', d.line_count, 'lotCount', d.lot_count,
      'postedAt', d.posted_at, 'voidedAt', d.voided_at, 'voidReason', d.void_reason,
      'discardedAt', d.discarded_at, 'discardReason', d.discard_reason,
      'version', d.version, 'updatedAt', d.updated_at), d.status, d.draft_payload
    into v_header, v_status, v_payload
    from public.opening_stock_docs d
    join public.inventory_locations l on l.id = d.location_id
   where d.id = p_doc_id;
  if not found then
    raise exception 'ZELL_INV_NOT_FOUND' using errcode = '45201', detail = 'docId';
  end if;
  if v_status in ('posted', 'voided') then
    select coalesce(jsonb_agg(jsonb_build_object('lineId', x.id, 'lineNo', x.line_no, 'kind', x.line_kind,
      'productId', x.product_id, 'productName', x.product_name_snapshot, 'saleUnit', x.sale_unit_snapshot,
      'widthCm', x.width_cm_snapshot, 'rollCount', x.roll_count, 'totalLengthCm', x.total_length_cm,
      'quantity', x.quantity, 'lineTotalPiastres', x.line_total_piastres, 'zeroCostReason', x.zero_cost_reason,
             'costIsEstimated', x.cost_is_estimated, 'estimateNote', x.estimate_note) order by x.line_no), '[]'::jsonb)
      into v_lines
      from public.opening_stock_lines x where x.doc_id = p_doc_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'lotId', s.id, 'lotCode', s.lot_code, 'sourceKind', s.source_kind, 'lotKind', s.lot_kind,
      'lotSequence', s.lot_sequence, 'productId', s.product_id, 'locationId', s.location_id,
      'widthCm', s.width_cm_snapshot, 'initialLengthCm', s.initial_length_cm, 'initialQuantity', s.initial_quantity,
      'baseCostPiastres', s.base_cost_piastres, 'allocatedExtrasPiastres', s.allocated_extras_piastres,
      'allocatedDiscountPiastres', s.allocated_discount_piastres, 'landedCostPiastres', s.landed_cost_piastres,
      'costIsEstimated', s.cost_is_estimated, 'receivedOn', s.received_on, 'status', s.status, 'voidedAt', s.voided_at) || jsonb_build_object('lineNo', x.line_no) order by x.line_no, s.lot_sequence), '[]'::jsonb)
      into v_lots
      from public.stock_lots s join public.opening_stock_lines x on x.id = s.opening_line_id
     where x.doc_id = p_doc_id;
  end if;
  return jsonb_build_object('header', v_header, 'draftPayload', v_payload, 'lines', v_lines, 'lots', v_lots);
end
$fn$;

create function public.zell_inv_preview_opening(p_actor uuid, p_doc jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_doc jsonb;
  v_prod jsonb;
  v_item jsonb;
  v_p jsonb;
  v_i integer;
  v_j integer;
  v_total bigint;
  v_lens bigint[];
  v_bases bigint[];
  v_lot_line integer[];
  v_lot_seq integer[];
  v_ext bigint[];
  v_dis bigint[];
  v_out jsonb;
  v_total_all bigint;
  v_total_est bigint;
begin
  perform public.zell_inv_assert_owner(p_actor);
  v_doc := public.zell_inv_normalize_opening(p_doc);
  select coalesce(jsonb_object_agg(r.product_id::text, jsonb_build_object('name', r.name_ar, 'unit', r.sale_unit, 'base', r.base_width_cm, 'widths', to_jsonb(r.active_widths))), '{}'::jsonb)
    into v_prod
    from public.zell_inv_read_products(array(select distinct (e ->> 'productId')::integer from jsonb_array_elements(v_doc -> 'lines') e order by 1)) r;
  for v_i in 0 .. jsonb_array_length(v_doc -> 'lines') - 1 loop
    v_item := v_doc -> 'lines' -> v_i;
    v_p := v_prod -> (v_item ->> 'productId');
    if v_p is null or (v_p ->> 'unit') is distinct from (case when v_item ->> 'kind' = 'roll' then 'meter' else 'piece' end) then
      raise exception 'ZELL_INV_PRODUCT_UNIT' using errcode = '45206', detail = 'lines[' || v_i || '].productId';
    end if;
    if v_item ->> 'kind' = 'roll' then
      if not public.zell_inv_width_allowed((v_p ->> 'base')::integer,
                                           array(select x::integer from jsonb_array_elements_text(v_p -> 'widths') x),
                                           (v_item ->> 'widthCm')::integer) then
        raise exception 'ZELL_INV_WIDTH_NOT_ALLOWED' using errcode = '45207', detail = 'lines[' || v_i || '].widthCm';
      end if;
    end if;
  end loop;
  v_bases := '{}';
  v_lot_line := '{}';
  v_lot_seq := '{}';
  for v_i in 0 .. jsonb_array_length(v_doc -> 'lines') - 1 loop
    v_item := (v_doc -> 'lines') -> v_i;
    v_total := (v_item ->> 'lineTotalPiastres')::bigint;
    if v_item ->> 'kind' = 'roll' then
      v_lens := array(select (r.value ->> 'lengthCm')::bigint
                        from jsonb_array_elements(v_item -> 'rolls') with ordinality as r(value, ord)
                       order by r.ord);
      v_bases := v_bases || public.zell_inv_allocate_lr(v_total, v_lens);
      v_lot_line := v_lot_line || array_fill(v_i + 1, array[array_length(v_lens, 1)]);
      v_lot_seq := v_lot_seq || array(select g from generate_series(1, array_length(v_lens, 1)) g);
    else
      v_bases := v_bases || v_total;
      v_lot_line := v_lot_line || (v_i + 1);
      v_lot_seq := v_lot_seq || 1;
    end if;
  end loop;
  v_ext := array_fill(0::bigint, array[coalesce(array_length(v_bases, 1), 0)]);
  v_dis := v_ext;
  v_out := '[]'::jsonb;
  for v_j in 1 .. coalesce(array_length(v_bases, 1), 0) loop
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'lineNo', v_lot_line[v_j], 'lotSequence', v_lot_seq[v_j], 'baseCostPiastres', v_bases[v_j],
      'allocatedExtrasPiastres', v_ext[v_j], 'allocatedDiscountPiastres', v_dis[v_j],
      'landedCostPiastres', v_bases[v_j] + v_ext[v_j] - v_dis[v_j]));
  end loop;
  select coalesce(sum((e ->> 'lineTotalPiastres')::bigint), 0),
         coalesce(sum((e ->> 'lineTotalPiastres')::bigint) filter (where (e ->> 'costIsEstimated')::boolean), 0)
    into v_total_all, v_total_est
    from jsonb_array_elements(v_doc -> 'lines') e;
  return jsonb_build_object(
    'totals', jsonb_build_object('itemsTotalPiastres', v_total_all, 'estimatedTotalPiastres', v_total_est),
    'lots', v_out);
end
$fn$;

create function public.zell_inv_list_lots(p_actor uuid, p_status text, p_product_id integer, p_location_id bigint,
                                          p_limit integer, p_before_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer;
  v_before bigint := coalesce(p_before_id, 9223372036854775807);
  v_ids bigint[];
  v_items jsonb;
begin
  perform public.zell_inv_assert_owner(p_actor);
  v_limit := coalesce(p_limit, 25);
  if v_limit < 1 or v_limit > 100 then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'limit';
  end if;
  if p_status is null or p_status not in ('active', 'voided') then
    raise exception 'ZELL_INV_INVALID' using errcode = '45203', detail = 'status';
  end if;
  if p_product_id is null and p_location_id is null then
    v_ids := array(select s.id from public.stock_lots s
                    where s.status = p_status and s.id < v_before order by s.id desc limit v_limit);
  elsif p_location_id is null then
    v_ids := array(select s.id from public.stock_lots s
                    where s.product_id = p_product_id and s.status = p_status and s.id < v_before
                    order by s.id desc limit v_limit);
  elsif p_product_id is null then
    v_ids := array(select s.id from public.stock_lots s
                    where s.location_id = p_location_id and s.status = p_status and s.id < v_before
                    order by s.id desc limit v_limit);
  else
    v_ids := array(select s.id from public.stock_lots s
                    where s.product_id = p_product_id and s.location_id = p_location_id and s.status = p_status
                      and s.id < v_before order by s.id desc limit v_limit);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'lotId', s.id, 'lotCode', s.lot_code, 'sourceKind', s.source_kind, 'lotKind', s.lot_kind,
      'lotSequence', s.lot_sequence, 'productId', s.product_id, 'locationId', s.location_id,
      'widthCm', s.width_cm_snapshot, 'initialLengthCm', s.initial_length_cm, 'initialQuantity', s.initial_quantity,
      'baseCostPiastres', s.base_cost_piastres, 'allocatedExtrasPiastres', s.allocated_extras_piastres,
      'allocatedDiscountPiastres', s.allocated_discount_piastres, 'landedCostPiastres', s.landed_cost_piastres,
      'costIsEstimated', s.cost_is_estimated, 'receivedOn', s.received_on, 'status', s.status, 'voidedAt', s.voided_at) order by s.id desc), '[]'::jsonb)
    into v_items
    from public.stock_lots s where s.id = any (v_ids);
  return jsonb_build_object('items', v_items,
                            'nextBeforeId', case when cardinality(v_ids) = v_limit then v_ids[v_limit] end);
end
$fn$;


-- (11) ملكية الدوال (§2.1): CREATE مؤقت → OWNER TO → SET LOCAL ROLE (revoke/grant) → RESET ROLE → سحب CREATE.
grant usage on schema public to zell_inventory_definer;
grant create on schema public to zell_inventory_definer;
alter function public.zell_inv_create_location(uuid, uuid, text, text) owner to zell_inventory_definer;
alter function public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean) owner to zell_inventory_definer;
alter function public.zell_inv_create_supplier(uuid, uuid, text, text, text) owner to zell_inventory_definer;
alter function public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean) owner to zell_inventory_definer;
alter function public.zell_inv_create_purchase(uuid, uuid, jsonb) owner to zell_inventory_definer;
alter function public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb) owner to zell_inventory_definer;
alter function public.zell_inv_post_purchase(uuid, uuid, bigint, integer) owner to zell_inventory_definer;
alter function public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text) owner to zell_inventory_definer;
alter function public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text) owner to zell_inventory_definer;
alter function public.zell_inv_create_opening(uuid, uuid, jsonb) owner to zell_inventory_definer;
alter function public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb) owner to zell_inventory_definer;
alter function public.zell_inv_post_opening(uuid, uuid, bigint, integer) owner to zell_inventory_definer;
alter function public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text) owner to zell_inventory_definer;
alter function public.zell_inv_void_opening(uuid, uuid, bigint, integer, text) owner to zell_inventory_definer;
alter function public.zell_inv_list_locations(uuid, boolean, integer, bigint) owner to zell_inventory_definer;
alter function public.zell_inv_list_suppliers(uuid, boolean, integer, text) owner to zell_inventory_definer;
alter function public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint) owner to zell_inventory_definer;
alter function public.zell_inv_get_purchase(uuid, bigint) owner to zell_inventory_definer;
alter function public.zell_inv_preview_purchase(uuid, jsonb) owner to zell_inventory_definer;
alter function public.zell_inv_list_openings(uuid, text, integer, bigint) owner to zell_inventory_definer;
alter function public.zell_inv_get_opening(uuid, bigint) owner to zell_inventory_definer;
alter function public.zell_inv_preview_opening(uuid, jsonb) owner to zell_inventory_definer;
alter function public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint) owner to zell_inventory_definer;
alter function public.zell_inv_width_allowed(integer, integer[], integer) owner to zell_inventory_definer;
alter function public.zell_inv_allocate_lr(bigint, bigint[]) owner to zell_inventory_definer;
alter function public.zell_inv_normalize_purchase(jsonb) owner to zell_inventory_definer;
alter function public.zell_inv_normalize_opening(jsonb) owner to zell_inventory_definer;
alter function public.zell_inv_command_check(uuid, uuid, text, text) owner to zell_inventory_definer;
alter function public.zell_inv_doc_void_blockers(text, bigint) owner to zell_inventory_definer;
alter function public.zell_inv_unknown_lot_references() owner to zell_inventory_definer;
alter function public.zell_inv_void_contract_version() owner to zell_inventory_definer;

set local role zell_inventory_definer;
revoke all on function public.zell_inv_create_location(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean) from public, anon, authenticated;
revoke all on function public.zell_inv_create_supplier(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.zell_inv_create_purchase(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb) from public, anon, authenticated;
revoke all on function public.zell_inv_post_purchase(uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text) from public, anon, authenticated;
revoke all on function public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text) from public, anon, authenticated;
revoke all on function public.zell_inv_create_opening(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb) from public, anon, authenticated;
revoke all on function public.zell_inv_post_opening(uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text) from public, anon, authenticated;
revoke all on function public.zell_inv_void_opening(uuid, uuid, bigint, integer, text) from public, anon, authenticated;
revoke all on function public.zell_inv_list_locations(uuid, boolean, integer, bigint) from public, anon, authenticated;
revoke all on function public.zell_inv_list_suppliers(uuid, boolean, integer, text) from public, anon, authenticated;
revoke all on function public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint) from public, anon, authenticated;
revoke all on function public.zell_inv_get_purchase(uuid, bigint) from public, anon, authenticated;
revoke all on function public.zell_inv_preview_purchase(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.zell_inv_list_openings(uuid, text, integer, bigint) from public, anon, authenticated;
revoke all on function public.zell_inv_get_opening(uuid, bigint) from public, anon, authenticated;
revoke all on function public.zell_inv_preview_opening(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.zell_inv_create_location(uuid, uuid, text, text) to service_role;
grant execute on function public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean) to service_role;
grant execute on function public.zell_inv_create_supplier(uuid, uuid, text, text, text) to service_role;
grant execute on function public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean) to service_role;
grant execute on function public.zell_inv_create_purchase(uuid, uuid, jsonb) to service_role;
grant execute on function public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb) to service_role;
grant execute on function public.zell_inv_post_purchase(uuid, uuid, bigint, integer) to service_role;
grant execute on function public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text) to service_role;
grant execute on function public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text) to service_role;
grant execute on function public.zell_inv_create_opening(uuid, uuid, jsonb) to service_role;
grant execute on function public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb) to service_role;
grant execute on function public.zell_inv_post_opening(uuid, uuid, bigint, integer) to service_role;
grant execute on function public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text) to service_role;
grant execute on function public.zell_inv_void_opening(uuid, uuid, bigint, integer, text) to service_role;
grant execute on function public.zell_inv_list_locations(uuid, boolean, integer, bigint) to service_role;
grant execute on function public.zell_inv_list_suppliers(uuid, boolean, integer, text) to service_role;
grant execute on function public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint) to service_role;
grant execute on function public.zell_inv_get_purchase(uuid, bigint) to service_role;
grant execute on function public.zell_inv_preview_purchase(uuid, jsonb) to service_role;
grant execute on function public.zell_inv_list_openings(uuid, text, integer, bigint) to service_role;
grant execute on function public.zell_inv_get_opening(uuid, bigint) to service_role;
grant execute on function public.zell_inv_preview_opening(uuid, jsonb) to service_role;
grant execute on function public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint) to service_role;
revoke all on function public.zell_inv_width_allowed(integer, integer[], integer) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_allocate_lr(bigint, bigint[]) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_normalize_purchase(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_normalize_opening(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_command_check(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_doc_void_blockers(text, bigint) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_unknown_lot_references() from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_void_contract_version() from public, anon, authenticated, service_role;
reset role;

revoke create on schema public from zell_inventory_definer;

-- الدوال المملوكة لـ postgres
revoke all on function public.zell_inv_assert_owner(uuid) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_lock_products(integer[]) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_read_products(integer[]) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_product_has_stock_refs(integer) from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_trg_no_delete() from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_trg_no_truncate() from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_trg_doc_guard() from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_trg_child_insert_guard() from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_trg_append_only() from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_trg_lot_update_guard() from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_trg_master_guard() from public, anon, authenticated, service_role;
revoke all on function public.zell_inv_trg_products_sale_unit() from public, anon, authenticated, service_role;
grant execute on function public.zell_inv_assert_owner(uuid) to zell_inventory_definer;
grant execute on function public.zell_inv_lock_products(integer[]) to zell_inventory_definer;
grant execute on function public.zell_inv_read_products(integer[]) to zell_inventory_definer;


-- (12) الجداول: RLS + policy واحدة للدور + صلاحيات صريحة (مفيش DELETE ولا TRUNCATE لأي دور غير المالك).
alter table public.inventory_locations enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchase_docs enable row level security;
alter table public.purchase_doc_lines enable row level security;
alter table public.purchase_doc_charges enable row level security;
alter table public.opening_stock_docs enable row level security;
alter table public.opening_stock_lines enable row level security;
alter table public.stock_lots enable row level security;
alter table public.inventory_commands enable row level security;
alter table public.inventory_audit_log enable row level security;
revoke all on table public.inventory_locations from public, anon, authenticated, service_role;
revoke all on table public.suppliers from public, anon, authenticated, service_role;
revoke all on table public.purchase_docs from public, anon, authenticated, service_role;
revoke all on table public.purchase_doc_lines from public, anon, authenticated, service_role;
revoke all on table public.purchase_doc_charges from public, anon, authenticated, service_role;
revoke all on table public.opening_stock_docs from public, anon, authenticated, service_role;
revoke all on table public.opening_stock_lines from public, anon, authenticated, service_role;
revoke all on table public.stock_lots from public, anon, authenticated, service_role;
revoke all on table public.inventory_commands from public, anon, authenticated, service_role;
revoke all on table public.inventory_audit_log from public, anon, authenticated, service_role;
create policy zinv_definer_inventory_locations on public.inventory_locations for all to zell_inventory_definer using (true) with check (true);
create policy zinv_definer_suppliers on public.suppliers for all to zell_inventory_definer using (true) with check (true);
create policy zinv_definer_purchase_docs on public.purchase_docs for all to zell_inventory_definer using (true) with check (true);
create policy zinv_definer_purchase_doc_lines on public.purchase_doc_lines for all to zell_inventory_definer using (true) with check (true);
create policy zinv_definer_purchase_doc_charges on public.purchase_doc_charges for all to zell_inventory_definer using (true) with check (true);
create policy zinv_definer_opening_stock_docs on public.opening_stock_docs for all to zell_inventory_definer using (true) with check (true);
create policy zinv_definer_opening_stock_lines on public.opening_stock_lines for all to zell_inventory_definer using (true) with check (true);
create policy zinv_definer_stock_lots on public.stock_lots for all to zell_inventory_definer using (true) with check (true);
create policy zinv_definer_inventory_commands on public.inventory_commands for all to zell_inventory_definer using (true) with check (true);
create policy zinv_definer_inventory_audit_log on public.inventory_audit_log for all to zell_inventory_definer using (true) with check (true);
grant select, insert on table public.inventory_locations to zell_inventory_definer;
grant select, insert on table public.suppliers to zell_inventory_definer;
grant select, insert on table public.purchase_docs to zell_inventory_definer;
grant select, insert on table public.purchase_doc_lines to zell_inventory_definer;
grant select, insert on table public.purchase_doc_charges to zell_inventory_definer;
grant select, insert on table public.opening_stock_docs to zell_inventory_definer;
grant select, insert on table public.opening_stock_lines to zell_inventory_definer;
grant select, insert on table public.stock_lots to zell_inventory_definer;
grant select, insert on table public.inventory_commands to zell_inventory_definer;
grant select, insert on table public.inventory_audit_log to zell_inventory_definer;
grant update (name, is_active, version, updated_at, updated_by) on table public.inventory_locations to zell_inventory_definer;
grant update (name, name_key, phone, note, is_active, version, updated_at, updated_by) on table public.suppliers to zell_inventory_definer;
grant update (status, supplier_id, supplier_ref, location_id, doc_date, note, draft_payload, supplier_discount_piastres, items_subtotal_piastres, extras_total_piastres, total_cost_piastres, line_count, charge_count, lot_count, supplier_name_snapshot, location_name_snapshot, posted_at, posted_by, voided_at, voided_by, void_reason, discarded_at, discarded_by, discard_reason, version, updated_at, updated_by) on table public.purchase_docs to zell_inventory_definer;
grant update (status, location_id, as_of_date, note, draft_payload, items_total_piastres, estimated_total_piastres, line_count, lot_count, location_name_snapshot, posted_at, posted_by, voided_at, voided_by, void_reason, discarded_at, discarded_by, discard_reason, version, updated_at, updated_by) on table public.opening_stock_docs to zell_inventory_definer;
grant update (status, voided_at, voided_by) on table public.stock_lots to zell_inventory_definer;

-- sequences: USAGE للدور بس
revoke all on sequence public.purchase_doc_no_seq from public, anon, authenticated, service_role;
revoke all on sequence public.opening_doc_no_seq from public, anon, authenticated, service_role;
revoke all on sequence public.roll_lot_seq from public, anon, authenticated, service_role;
revoke all on sequence public.batch_lot_seq from public, anon, authenticated, service_role;
grant usage on sequence public.purchase_doc_no_seq to zell_inventory_definer;
grant usage on sequence public.opening_doc_no_seq to zell_inventory_definer;
grant usage on sequence public.roll_lot_seq to zell_inventory_definer;
grant usage on sequence public.batch_lot_seq to zell_inventory_definer;
do $zseq$
declare
  v_t text;
  v_seq text;
begin
  foreach v_t in array array['inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_audit_log'] loop
    v_seq := pg_catalog.pg_get_serial_sequence('public.' || v_t, 'id');
    if v_seq is null then
      raise exception 'ZELL_0020_IDENTITY_SEQUENCE_MISSING %', v_t;
    end if;
    execute pg_catalog.format('revoke all on sequence %s from public, anon, authenticated, service_role', v_seq);
    execute pg_catalog.format('grant usage on sequence %s to zell_inventory_definer', v_seq);
  end loop;
end
$zseq$;

-- (13) triggers على الجداول الجديدة
create trigger zinv_no_delete before delete on public.inventory_locations for each row execute function public.zell_inv_trg_no_delete();
create trigger zinv_no_delete before delete on public.suppliers for each row execute function public.zell_inv_trg_no_delete();
create trigger zinv_no_delete before delete on public.purchase_docs for each row execute function public.zell_inv_trg_no_delete();
create trigger zinv_no_delete before delete on public.purchase_doc_lines for each row execute function public.zell_inv_trg_no_delete();
create trigger zinv_no_delete before delete on public.purchase_doc_charges for each row execute function public.zell_inv_trg_no_delete();
create trigger zinv_no_delete before delete on public.opening_stock_docs for each row execute function public.zell_inv_trg_no_delete();
create trigger zinv_no_delete before delete on public.opening_stock_lines for each row execute function public.zell_inv_trg_no_delete();
create trigger zinv_no_delete before delete on public.stock_lots for each row execute function public.zell_inv_trg_no_delete();
create trigger zinv_no_delete before delete on public.inventory_commands for each row execute function public.zell_inv_trg_no_delete();
create trigger zinv_no_delete before delete on public.inventory_audit_log for each row execute function public.zell_inv_trg_no_delete();
create trigger zinv_no_truncate before truncate on public.inventory_locations for each statement execute function public.zell_inv_trg_no_truncate();
create trigger zinv_no_truncate before truncate on public.suppliers for each statement execute function public.zell_inv_trg_no_truncate();
create trigger zinv_no_truncate before truncate on public.purchase_docs for each statement execute function public.zell_inv_trg_no_truncate();
create trigger zinv_no_truncate before truncate on public.purchase_doc_lines for each statement execute function public.zell_inv_trg_no_truncate();
create trigger zinv_no_truncate before truncate on public.purchase_doc_charges for each statement execute function public.zell_inv_trg_no_truncate();
create trigger zinv_no_truncate before truncate on public.opening_stock_docs for each statement execute function public.zell_inv_trg_no_truncate();
create trigger zinv_no_truncate before truncate on public.opening_stock_lines for each statement execute function public.zell_inv_trg_no_truncate();
create trigger zinv_no_truncate before truncate on public.stock_lots for each statement execute function public.zell_inv_trg_no_truncate();
create trigger zinv_no_truncate before truncate on public.inventory_commands for each statement execute function public.zell_inv_trg_no_truncate();
create trigger zinv_no_truncate before truncate on public.inventory_audit_log for each statement execute function public.zell_inv_trg_no_truncate();
create trigger zinv_doc_guard before update on public.purchase_docs for each row execute function public.zell_inv_trg_doc_guard();
create trigger zinv_doc_guard before update on public.opening_stock_docs for each row execute function public.zell_inv_trg_doc_guard();
create trigger zinv_child_insert_guard before insert on public.purchase_doc_lines for each row execute function public.zell_inv_trg_child_insert_guard();
create trigger zinv_child_insert_guard before insert on public.purchase_doc_charges for each row execute function public.zell_inv_trg_child_insert_guard();
create trigger zinv_child_insert_guard before insert on public.opening_stock_lines for each row execute function public.zell_inv_trg_child_insert_guard();
create trigger zinv_child_insert_guard before insert on public.stock_lots for each row execute function public.zell_inv_trg_child_insert_guard();
create trigger zinv_append_only before update on public.purchase_doc_lines for each row execute function public.zell_inv_trg_append_only();
create trigger zinv_append_only before update on public.purchase_doc_charges for each row execute function public.zell_inv_trg_append_only();
create trigger zinv_append_only before update on public.opening_stock_lines for each row execute function public.zell_inv_trg_append_only();
create trigger zinv_append_only before update on public.inventory_commands for each row execute function public.zell_inv_trg_append_only();
create trigger zinv_append_only before update on public.inventory_audit_log for each row execute function public.zell_inv_trg_append_only();
create trigger zinv_lot_update_guard before update on public.stock_lots for each row execute function public.zell_inv_trg_lot_update_guard();
create trigger zinv_master_guard before update on public.inventory_locations for each row execute function public.zell_inv_trg_master_guard();
create trigger zinv_master_guard before update on public.suppliers for each row execute function public.zell_inv_trg_master_guard();


-- (14) آخر حاجة (§12.2): FKs على products و trigger sale_unit — SHARE ROW EXCLUSIVE على products لحد الـcommit.
alter table public.purchase_doc_lines
  add constraint purchase_doc_lines_product_fk foreign key (product_id) references public.products (id) on delete restrict;
alter table public.opening_stock_lines
  add constraint opening_stock_lines_product_fk foreign key (product_id) references public.products (id) on delete restrict;
alter table public.stock_lots
  add constraint stock_lots_product_fk foreign key (product_id) references public.products (id) on delete restrict;
create trigger zinv_products_sale_unit
  before update of sale_unit on public.products
  for each row
  when (old.sale_unit is distinct from new.sale_unit)
  execute function public.zell_inv_trg_products_sale_unit();


-- (15) postflight (أي فشل = المعاملة كلها بترجع)

do $zpost$
declare
  v_bad text;
  v_definer oid := 'zell_inventory_definer'::regrole;
  v_postgres oid := 'postgres'::regrole;
  v_service oid := 'service_role'::regrole;
  v_tables text[] := array['inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log'];
  v_table_oids oid[];
  v_seqs text[];
  v_t text;
  v_priv text;
  v_role text;
  v_src text;
  v_lock integer;
  v_write integer;
  r record;
begin
  v_table_oids := array(select ('public.' || t)::regclass::oid from unnest(v_tables) t);
  
  -- (a) البصمة زي اللقطة بالظبط
  if (select row(b.*)::text from pg_temp.zell_0020_fp_before b)
     is distinct from (select row(n.*)::text from pg_temp.zell_0020_fp_now n) then
    raise exception 'ZELL_0020_FINGERPRINT_CHANGED';
  end if;

  -- (b) RLS + policy واحدة لكل جدول
  select string_agg(t, ',') into v_bad
    from unnest(v_tables) t
   where not exists (select 1 from pg_catalog.pg_class c where c.oid = ('public.' || t)::regclass and c.relrowsecurity)
      or (select count(*) from pg_catalog.pg_policy p where p.polrelid = ('public.' || t)::regclass) <> 1
      or not exists (select 1 from pg_catalog.pg_policy p
                      where p.polrelid = ('public.' || t)::regclass and p.polname = 'zinv_definer_' || t
                        and p.polroles = array[v_definer] and p.polcmd = '*'
                        and pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'true'
                        and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) = 'true');
  if v_bad is not null then
    raise exception 'ZELL_0020_RLS_POLICIES %', v_bad;
  end if;

  -- (c) الـACL المباشر للجداول (مستوى الجدول)
  with exp as (
    select t as tbl, p as priv from unnest(v_tables) t cross join (values ('SELECT'), ('INSERT')) v(p)
  ), act as (
    select c.relname::text as tbl, a.privilege_type::text as priv, a.grantee, c.relowner
      from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) a
     where c.oid = any (v_table_oids)
  )
  select string_agg(x, ',') into v_bad from (
    select tbl || ':' || priv || ':foreign' as x from act where grantee <> relowner and grantee <> v_definer
    union all
    select tbl || ':' || priv || ':missing' from (select tbl, priv from exp
                                                  except select tbl, priv from act where grantee = v_definer) m
    union all
    select tbl || ':' || priv || ':extra' from (select tbl, priv from act where grantee = v_definer
                                                except select tbl, priv from exp) e
  ) z;
  if v_bad is not null then
    raise exception 'ZELL_0020_TABLE_ACL %', v_bad;
  end if;
  if exists (select 1 from pg_catalog.pg_class c where c.oid = any (v_table_oids) and c.relacl is null) then
    raise exception 'ZELL_0020_TABLE_ACL_DEFAULT';
  end if;

  -- (d) الـACL المباشر للأعمدة (UPDATE للدور بس)
  with exp(tbl, col) as (values ('inventory_locations', 'name'), ('inventory_locations', 'is_active'), ('inventory_locations', 'version'), ('inventory_locations', 'updated_at'), ('inventory_locations', 'updated_by'), ('suppliers', 'name'), ('suppliers', 'name_key'), ('suppliers', 'phone'), ('suppliers', 'note'), ('suppliers', 'is_active'), ('suppliers', 'version'), ('suppliers', 'updated_at'), ('suppliers', 'updated_by'), ('purchase_docs', 'status'), ('purchase_docs', 'supplier_id'), ('purchase_docs', 'supplier_ref'), ('purchase_docs', 'location_id'), ('purchase_docs', 'doc_date'), ('purchase_docs', 'note'), ('purchase_docs', 'draft_payload'), ('purchase_docs', 'supplier_discount_piastres'), ('purchase_docs', 'items_subtotal_piastres'), ('purchase_docs', 'extras_total_piastres'), ('purchase_docs', 'total_cost_piastres'), ('purchase_docs', 'line_count'), ('purchase_docs', 'charge_count'), ('purchase_docs', 'lot_count'), ('purchase_docs', 'supplier_name_snapshot'), ('purchase_docs', 'location_name_snapshot'), ('purchase_docs', 'posted_at'), ('purchase_docs', 'posted_by'), ('purchase_docs', 'voided_at'), ('purchase_docs', 'voided_by'), ('purchase_docs', 'void_reason'), ('purchase_docs', 'discarded_at'), ('purchase_docs', 'discarded_by'), ('purchase_docs', 'discard_reason'), ('purchase_docs', 'version'), ('purchase_docs', 'updated_at'), ('purchase_docs', 'updated_by'), ('opening_stock_docs', 'status'), ('opening_stock_docs', 'location_id'), ('opening_stock_docs', 'as_of_date'), ('opening_stock_docs', 'note'), ('opening_stock_docs', 'draft_payload'), ('opening_stock_docs', 'items_total_piastres'), ('opening_stock_docs', 'estimated_total_piastres'), ('opening_stock_docs', 'line_count'), ('opening_stock_docs', 'lot_count'), ('opening_stock_docs', 'location_name_snapshot'), ('opening_stock_docs', 'posted_at'), ('opening_stock_docs', 'posted_by'), ('opening_stock_docs', 'voided_at'), ('opening_stock_docs', 'voided_by'), ('opening_stock_docs', 'void_reason'), ('opening_stock_docs', 'discarded_at'), ('opening_stock_docs', 'discarded_by'), ('opening_stock_docs', 'discard_reason'), ('opening_stock_docs', 'version'), ('opening_stock_docs', 'updated_at'), ('opening_stock_docs', 'updated_by'), ('stock_lots', 'status'), ('stock_lots', 'voided_at'), ('stock_lots', 'voided_by')),
  act as (
    select c.relname::text as tbl, a.attname::text as col, x.privilege_type::text as priv, x.grantee
      from pg_catalog.pg_class c
      join pg_catalog.pg_attribute a on a.attrelid = c.oid
      cross join lateral pg_catalog.aclexplode(a.attacl) x
     where c.oid = any (v_table_oids) and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  )
  select string_agg(x, ',') into v_bad from (
    select tbl || '.' || col || ':' || priv || ':foreign' as x from act where not (grantee = v_definer and priv = 'UPDATE')
    union all
    select tbl || '.' || col || ':missing' from (select tbl, col from exp
                                                 except select tbl, col from act where grantee = v_definer and priv = 'UPDATE') m
    union all
    select tbl || '.' || col || ':extra' from (select tbl, col from act where grantee = v_definer and priv = 'UPDATE'
                                               except select tbl, col from exp) e
  ) z;
  if v_bad is not null then
    raise exception 'ZELL_0020_COLUMN_ACL %', v_bad;
  end if;

  -- (e) الصلاحيات الفعلية على الجداول
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_t in array v_tables loop
      foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if pg_catalog.has_table_privilege(v_role, 'public.' || v_t, v_priv) then
          raise exception 'ZELL_0020_EFFECTIVE_TABLE % % %', v_role, v_t, v_priv;
        end if;
      end loop;
      if pg_catalog.has_any_column_privilege(v_role, 'public.' || v_t, 'SELECT, INSERT, UPDATE, REFERENCES') then
        raise exception 'ZELL_0020_EFFECTIVE_COLUMNS % %', v_role, v_t;
      end if;
    end loop;
  end loop;
  foreach v_t in array v_tables loop
    if not pg_catalog.has_table_privilege('zell_inventory_definer', 'public.' || v_t, 'SELECT')
       or not pg_catalog.has_table_privilege('zell_inventory_definer', 'public.' || v_t, 'INSERT')
       or pg_catalog.has_table_privilege('zell_inventory_definer', 'public.' || v_t, 'DELETE')
       or pg_catalog.has_table_privilege('zell_inventory_definer', 'public.' || v_t, 'TRUNCATE') then
      raise exception 'ZELL_0020_EFFECTIVE_DEFINER %', v_t;
    end if;
  end loop;
  if pg_catalog.has_table_privilege('zell_inventory_definer', 'public.products', 'SELECT')
     or pg_catalog.has_table_privilege('zell_inventory_definer', 'public.admin_users', 'SELECT') then
    raise exception 'ZELL_0020_DEFINER_READS_LIVE_TABLES';
  end if;

  -- (f) الـsequences: مباشر + فعلي
  v_seqs := array['public.purchase_doc_no_seq', 'public.opening_doc_no_seq', 'public.roll_lot_seq', 'public.batch_lot_seq']
            || array(select pg_catalog.pg_get_serial_sequence('public.' || t, 'id')
                       from unnest(array['inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_audit_log']) t);
  if array_position(v_seqs, null) is not null then
    raise exception 'ZELL_0020_SEQUENCE_MISSING';
  end if;
  foreach v_t in array v_seqs loop
    select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',') into v_bad
      from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) a
     where c.oid = v_t::regclass and a.grantee <> c.relowner
       and not (a.grantee = v_definer and a.privilege_type = 'USAGE');
    if v_bad is not null or (select c.relacl from pg_catalog.pg_class c where c.oid = v_t::regclass) is null
       or not pg_catalog.has_sequence_privilege('zell_inventory_definer', v_t, 'USAGE') then
      raise exception 'ZELL_0020_SEQUENCE_ACL % %', v_t, coalesce(v_bad, '');
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_sequence_privilege(v_role, v_t, 'USAGE')
         or pg_catalog.has_sequence_privilege(v_role, v_t, 'SELECT')
         or pg_catalog.has_sequence_privilege(v_role, v_t, 'UPDATE') then
        raise exception 'ZELL_0020_EFFECTIVE_SEQUENCE % %', v_role, v_t;
      end if;
    end loop;
  end loop;

  -- (g) الدوال: العدد، المالك، الأمان، التقلب، search_path، والـACL المباشر والفعلي
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%') <> 43 then
    raise exception 'ZELL_0020_FUNCTION_COUNT';
  end if;
  for r in
    select e.sig, e.owner, e.secdef, e.vol, e.cat, pg_catalog.to_regprocedure(e.sig) as oid
      from (values
      ('public.zell_inv_create_location(uuid, uuid, text, text)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_create_supplier(uuid, uuid, text, text, text)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_create_purchase(uuid, uuid, jsonb)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_post_purchase(uuid, uuid, bigint, integer)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_create_opening(uuid, uuid, jsonb)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_post_opening(uuid, uuid, bigint, integer)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_void_opening(uuid, uuid, bigint, integer, text)', 'definer', true, 'v', 'rpc'),
      ('public.zell_inv_list_locations(uuid, boolean, integer, bigint)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_list_suppliers(uuid, boolean, integer, text)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_get_purchase(uuid, bigint)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_preview_purchase(uuid, jsonb)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_list_openings(uuid, text, integer, bigint)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_get_opening(uuid, bigint)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_preview_opening(uuid, jsonb)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint)', 'definer', true, 's', 'rpc'),
      ('public.zell_inv_assert_owner(uuid)', 'postgres', true, 's', 'pg_helper'),
      ('public.zell_inv_lock_products(integer[])', 'postgres', true, 'v', 'pg_helper'),
      ('public.zell_inv_read_products(integer[])', 'postgres', true, 's', 'pg_helper'),
      ('public.zell_inv_product_has_stock_refs(integer)', 'postgres', false, 's', 'pg_private'),
      ('public.zell_inv_width_allowed(integer, integer[], integer)', 'definer', false, 'i', 'def_helper'),
      ('public.zell_inv_allocate_lr(bigint, bigint[])', 'definer', false, 'i', 'def_helper'),
      ('public.zell_inv_normalize_purchase(jsonb)', 'definer', false, 's', 'def_helper'),
      ('public.zell_inv_normalize_opening(jsonb)', 'definer', false, 's', 'def_helper'),
      ('public.zell_inv_command_check(uuid, uuid, text, text)', 'definer', false, 'v', 'def_helper'),
      ('public.zell_inv_doc_void_blockers(text, bigint)', 'definer', false, 's', 'def_helper'),
      ('public.zell_inv_unknown_lot_references()', 'definer', false, 's', 'def_helper'),
      ('public.zell_inv_void_contract_version()', 'definer', false, 'i', 'def_helper'),
      ('public.zell_inv_trg_no_delete()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_no_truncate()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_doc_guard()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_child_insert_guard()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_append_only()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_lot_update_guard()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_master_guard()', 'postgres', false, 'v', 'trigger'),
      ('public.zell_inv_trg_products_sale_unit()', 'postgres', true, 'v', 'trigger')
      ) as e(sig, owner, secdef, vol, cat)
  loop
    if r.oid is null then
      raise exception 'ZELL_0020_FUNCTION_MISSING %', r.sig;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_proc p
       where p.oid = r.oid
         and p.proowner = case r.owner when 'definer' then v_definer else v_postgres end
         and p.prosecdef = r.secdef
         and p.provolatile = r.vol::"char"
         and 'search_path=""' = any (coalesce(p.proconfig, '{}'::text[]))
         and p.proacl is not null) then
      raise exception 'ZELL_0020_FUNCTION_SHAPE %', r.sig;
    end if;
    if (select array_agg(distinct a.grantee order by a.grantee)
          from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
         where p.oid = r.oid)
       is distinct from
       (select array_agg(g order by g) from unnest(case r.cat
          when 'rpc' then array[v_definer, v_service]
          when 'pg_helper' then array[v_postgres, v_definer]
          when 'def_helper' then array[v_definer]
          else array[v_postgres] end) g) then
      raise exception 'ZELL_0020_FUNCTION_ACL %', r.sig;
    end if;
    if exists (select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
                where p.oid = r.oid and a.privilege_type <> 'EXECUTE') then
      raise exception 'ZELL_0020_FUNCTION_ACL_PRIV %', r.sig;
    end if;
    if pg_catalog.has_function_privilege('anon', r.oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', r.oid, 'EXECUTE') <> (r.cat = 'rpc') then
      raise exception 'ZELL_0020_FUNCTION_EFFECTIVE %', r.sig;
    end if;
  end loop;

  -- (h) الـschema: الدور معاه USAGE، والـCREATE **الفعلي** false
  if pg_catalog.has_schema_privilege('zell_inventory_definer', 'public', 'CREATE')
     or not pg_catalog.has_schema_privilege('zell_inventory_definer', 'public', 'USAGE') then
    raise exception 'ZELL_0020_SCHEMA_PRIVILEGES';
  end if;

  -- (i) الدور وشكل العضوية
  if not exists (select 1 from pg_catalog.pg_roles r2
                  where r2.oid = v_definer and not r2.rolcanlogin and not r2.rolbypassrls and not r2.rolinherit
                    and not r2.rolsuper and not r2.rolcreaterole and not r2.rolcreatedb and not r2.rolreplication)
     or exists (select 1 from pg_catalog.pg_auth_members m where m.member = v_definer)
     or exists (select 1 from pg_catalog.pg_auth_members m
                 where m.roleid = v_definer and m.member = v_postgres and m.inherit_option)
     or not exists (select 1 from pg_catalog.pg_auth_members m
                     where m.roleid = v_definer and m.member = v_postgres and m.admin_option)
     or not exists (select 1 from pg_catalog.pg_auth_members m
                     where m.roleid = v_definer and m.member = v_postgres and m.set_option)
     or exists (select 1 from pg_catalog.pg_auth_members m where m.roleid = v_definer and m.member <> v_postgres) then
    raise exception 'ZELL_0020_ROLE_SHAPE';
  end if;

  -- (j) الـtriggers (34 على الجداول الجديدة + واحد على products)
  with exp(tbl, tg, fn, typ) as (values ('inventory_locations', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('suppliers', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('purchase_docs', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('purchase_doc_lines', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('purchase_doc_charges', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('opening_stock_docs', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('opening_stock_lines', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('stock_lots', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('inventory_commands', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('inventory_audit_log', 'zinv_no_delete', 'zell_inv_trg_no_delete', 11), ('inventory_locations', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('suppliers', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('purchase_docs', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('purchase_doc_lines', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('purchase_doc_charges', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('opening_stock_docs', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('opening_stock_lines', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('stock_lots', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('inventory_commands', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('inventory_audit_log', 'zinv_no_truncate', 'zell_inv_trg_no_truncate', 34), ('purchase_docs', 'zinv_doc_guard', 'zell_inv_trg_doc_guard', 19), ('opening_stock_docs', 'zinv_doc_guard', 'zell_inv_trg_doc_guard', 19), ('purchase_doc_lines', 'zinv_child_insert_guard', 'zell_inv_trg_child_insert_guard', 7), ('purchase_doc_charges', 'zinv_child_insert_guard', 'zell_inv_trg_child_insert_guard', 7), ('opening_stock_lines', 'zinv_child_insert_guard', 'zell_inv_trg_child_insert_guard', 7), ('stock_lots', 'zinv_child_insert_guard', 'zell_inv_trg_child_insert_guard', 7), ('purchase_doc_lines', 'zinv_append_only', 'zell_inv_trg_append_only', 19), ('purchase_doc_charges', 'zinv_append_only', 'zell_inv_trg_append_only', 19), ('opening_stock_lines', 'zinv_append_only', 'zell_inv_trg_append_only', 19), ('inventory_commands', 'zinv_append_only', 'zell_inv_trg_append_only', 19), ('inventory_audit_log', 'zinv_append_only', 'zell_inv_trg_append_only', 19), ('stock_lots', 'zinv_lot_update_guard', 'zell_inv_trg_lot_update_guard', 19), ('inventory_locations', 'zinv_master_guard', 'zell_inv_trg_master_guard', 19), ('suppliers', 'zinv_master_guard', 'zell_inv_trg_master_guard', 19))
  select string_agg(e.tbl || '.' || e.tg, ',') into v_bad
    from exp e
   where not exists (select 1 from pg_catalog.pg_trigger g join pg_catalog.pg_proc f on f.oid = g.tgfoid
                      where g.tgrelid = ('public.' || e.tbl)::regclass and g.tgname = e.tg
                        and f.proname = e.fn and f.pronamespace = 'public'::regnamespace
                        and g.tgtype = e.typ and g.tgenabled = 'O');
  if v_bad is not null then
    raise exception 'ZELL_0020_TRIGGERS %', v_bad;
  end if;
  if (select count(*) from pg_catalog.pg_trigger g where g.tgrelid = any (v_table_oids) and not g.tgisinternal) <> 34 then
    raise exception 'ZELL_0020_TRIGGER_COUNT';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger g join pg_catalog.pg_proc f on f.oid = g.tgfoid
                  where g.tgrelid = 'public.products'::regclass and g.tgname = 'zinv_products_sale_unit'
                    and f.proname = 'zell_inv_trg_products_sale_unit' and g.tgtype = 19 and g.tgenabled = 'O'
                    and g.tgqual is not null
                    and g.tgattr::int2[] = array[(select a.attnum from pg_catalog.pg_attribute a
                                                   where a.attrelid = 'public.products'::regclass
                                                     and a.attname = 'sale_unit')]::int2[]) then
    raise exception 'ZELL_0020_PRODUCTS_TRIGGER';
  end if;

  -- (k) FKs على products
  if (select count(*) from pg_catalog.pg_constraint c
       where c.contype = 'f' and c.confrelid = 'public.products'::regclass
         and c.conname in ('purchase_doc_lines_product_fk', 'opening_stock_lines_product_fk', 'stock_lots_product_fk')
         and c.confdeltype = 'r') <> 3 then
    raise exception 'ZELL_0020_PRODUCT_FKS';
  end if;

  -- (l) اعتمادية قفل العروض (§2.6)
  select pg_catalog.lower(pg_catalog.regexp_replace(p.prosrc, '\s+', ' ', 'g')) into v_src
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.zell_set_product_widths(integer,jsonb)');
  if v_src is null then
    raise exception 'ZELL_0020_WIDTHS_FUNCTION_MISSING';
  end if;
  v_lock := pg_catalog.regexp_instr(v_src, 'from public\.products\M[^;]*for update');
  v_write := pg_catalog.regexp_instr(v_src, '(delete from|update|insert into) public\.product_widths');
  if v_lock = 0 or v_write = 0 or v_lock > v_write then
    raise exception 'ZELL_0020_WIDTHS_LOCK_CONTRACT_MISSING';
  end if;
  
  -- (m) البيانات: MAIN بس، والباقي صفر
  if (select count(*) from public.inventory_locations) <> 1
     or not exists (select 1 from public.inventory_locations l
                     where l.code = 'MAIN' and l.is_default and l.is_active and l.name = 'المخزن الرئيسي')
     or exists (select 1 from public.suppliers) or exists (select 1 from public.purchase_docs)
     or exists (select 1 from public.purchase_doc_lines) or exists (select 1 from public.purchase_doc_charges)
     or exists (select 1 from public.opening_stock_docs) or exists (select 1 from public.opening_stock_lines)
     or exists (select 1 from public.stock_lots) or exists (select 1 from public.inventory_commands)
     or exists (select 1 from public.inventory_audit_log) then
    raise exception 'ZELL_0020_DATA_NOT_EMPTY';
  end if;
end
$zpost$;

drop view pg_temp.zell_0020_fp_now;

-- <<< 0020 BODY

-- ═══ إطار الاختبار (pg_temp — بيختفي مع الـrollback) ═══
select pg_catalog.set_config('statement_timeout',
  case when pg_catalog.current_setting('zell.ptest_profile') = 'full' then '0' else '50s' end, true);

create temporary table zell_pt_log (
  n serial primary key, grp text not null, label text not null, status text not null, info text
) on commit drop;
create temporary table zell_pt_ctx (k text primary key, v text) on commit drop;

create function pg_temp.ok(p_grp text, p_label text, p_cond boolean, p_info text default null) returns void
language sql as $t$
  insert into pg_temp.zell_pt_log (grp, label, status, info)
  values (p_grp, p_label, case when coalesce(p_cond, false) then 'PASS' else 'FAIL' end, p_info);
$t$;

create function pg_temp.mark(p_grp text, p_label text, p_status text, p_info text default null) returns void
language sql as $t$
  insert into pg_temp.zell_pt_log (grp, label, status, info) values (p_grp, p_label, p_status, p_info);
$t$;

create function pg_temp.set_ctx(p_k text, p_v text) returns void
language sql as $t$
  insert into pg_temp.zell_pt_ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$t$;

create function pg_temp.c(p_k text) returns text language sql stable as $t$
  select v from pg_temp.zell_pt_ctx where k = p_k;
$t$;

create function pg_temp.ci(p_k text) returns bigint language sql stable as $t$
  select v::bigint from pg_temp.zell_pt_ctx where k = p_k;
$t$;

create function pg_temp.o() returns text language sql stable as $t$
  select quote_literal(v) || '::uuid' from pg_temp.zell_pt_ctx where k = 'OWNER';
$t$;

create function pg_temp.j(p jsonb) returns text language sql immutable as $t$
  select quote_literal(p::text) || '::jsonb';
$t$;

create function pg_temp.today() returns text language sql stable as $t$
  select to_char((now() at time zone 'Africa/Cairo')::date, 'YYYY-MM-DD');
$t$;

-- نداء RPC كـ service_role (الـcaller الحقيقي) — النتيجة بتفضل.
create function pg_temp.rpc(p_call text) returns jsonb language plpgsql as $t$
declare
  v_r jsonb;
begin
  set local role service_role;
  execute 'select ' || p_call into v_r;
  reset role;
  return v_r;
end
$t$;

-- تنفيذ SQL كدور معيّن ورجوع الـSQLSTATE ('OK' لو نجح). الأثر بيترجع دايمًا.
create function pg_temp.try_sql(p_sql text, p_role text) returns text language plpgsql as $t$
declare
  v_state text;
begin
  begin
    if p_role is not null then
      execute pg_catalog.format('set local role %I', p_role);
    end if;
    execute p_sql;
    v_state := 'OK';
    raise exception using errcode = 'ZPT01';
  exception when others then
    if v_state is null then
      get stacked diagnostics v_state = returned_sqlstate;
    end if;
  end;
  return v_state;
end
$t$;

create function pg_temp.expect(p_grp text, p_label text, p_call text, p_codes text[]) returns void
language plpgsql as $t$
declare
  v text;
begin
  v := pg_temp.try_sql('select ' || p_call, 'service_role');
  perform pg_temp.ok(p_grp, p_label, v = any (p_codes), v);
end
$t$;

create function pg_temp.expect_sql(p_grp text, p_label text, p_sql text, p_role text, p_codes text[]) returns void
language plpgsql as $t$
declare
  v text;
begin
  v := pg_temp.try_sql(p_sql, p_role);
  perform pg_temp.ok(p_grp, p_label, v = any (p_codes), v);
end
$t$;

create function pg_temp.roll(p_product bigint, p_width bigint, p_lengths integer[], p_total bigint, p_reason text default null)
returns jsonb language sql immutable as $t$
  select jsonb_build_object('kind', 'roll', 'productId', p_product, 'widthCm', p_width,
           'rolls', (select jsonb_agg(jsonb_build_object('lengthCm', u.x) order by u.o)
                       from unnest(p_lengths) with ordinality as u(x, o)),
           'lineTotalPiastres', p_total)
         || case when p_reason is null then '{}'::jsonb else jsonb_build_object('zeroCostReason', p_reason) end;
$t$;

create function pg_temp.batch(p_product bigint, p_qty bigint, p_total bigint, p_reason text default null)
returns jsonb language sql immutable as $t$
  select jsonb_build_object('kind', 'batch', 'productId', p_product, 'quantity', p_qty, 'lineTotalPiastres', p_total)
         || case when p_reason is null then '{}'::jsonb else jsonb_build_object('zeroCostReason', p_reason) end;
$t$;

create function pg_temp.oroll(p_product bigint, p_width bigint, p_lengths integer[], p_total bigint, p_est boolean,
                              p_note text, p_reason text default null)
returns jsonb language sql immutable as $t$
  select pg_temp.roll(p_product, p_width, p_lengths, p_total, p_reason)
         || jsonb_build_object('costIsEstimated', p_est, 'estimateNote', p_note);
$t$;

create function pg_temp.obatch(p_product bigint, p_qty bigint, p_total bigint, p_est boolean, p_note text,
                               p_reason text default null)
returns jsonb language sql immutable as $t$
  select pg_temp.batch(p_product, p_qty, p_total, p_reason)
         || jsonb_build_object('costIsEstimated', p_est, 'estimateNote', p_note);
$t$;

create function pg_temp.charge(p_kind text, p_amount bigint, p_note text default null)
returns jsonb language sql immutable as $t$
  select jsonb_build_object('kind', p_kind, 'amountPiastres', p_amount, 'reference', null, 'note', p_note);
$t$;

create function pg_temp.pdoc(p_lines jsonb, p_charges jsonb default '[]'::jsonb, p_discount bigint default 0,
                             p_supplier bigint default null, p_location bigint default null,
                             p_date text default null, p_note text default null)
returns jsonb language sql stable as $t$
  select jsonb_build_object('supplierId', p_supplier, 'supplierRef', null,
                            'locationId', coalesce(p_location, pg_temp.ci('MAIN')),
                            'docDate', coalesce(p_date, pg_temp.today()), 'note', p_note,
                            'charges', p_charges, 'supplierDiscountPiastres', p_discount, 'lines', p_lines);
$t$;

create function pg_temp.odoc(p_lines jsonb, p_location bigint default null, p_date text default null)
returns jsonb language sql stable as $t$
  select jsonb_build_object('locationId', coalesce(p_location, pg_temp.ci('MAIN')),
                            'asOfDate', coalesce(p_date, pg_temp.today()), 'note', null, 'lines', p_lines);
$t$;

-- اختصارات نداء (owner + command جديد)
create function pg_temp.create_purchase(p_doc jsonb) returns jsonb language sql as $t$
  select pg_temp.rpc(pg_catalog.format('public.zell_inv_create_purchase(%s, gen_random_uuid(), %s)', pg_temp.o(), pg_temp.j(p_doc)));
$t$;
create function pg_temp.post_purchase(p_id bigint, p_v integer) returns jsonb language sql as $t$
  select pg_temp.rpc(pg_catalog.format('public.zell_inv_post_purchase(%s, gen_random_uuid(), %s, %s)', pg_temp.o(), p_id, p_v));
$t$;
create function pg_temp.create_opening(p_doc jsonb) returns jsonb language sql as $t$
  select pg_temp.rpc(pg_catalog.format('public.zell_inv_create_opening(%s, gen_random_uuid(), %s)', pg_temp.o(), pg_temp.j(p_doc)));
$t$;
create function pg_temp.post_opening(p_id bigint, p_v integer) returns jsonb language sql as $t$
  select pg_temp.rpc(pg_catalog.format('public.zell_inv_post_opening(%s, gen_random_uuid(), %s, %s)', pg_temp.o(), p_id, p_v));
$t$;
create function pg_temp.ecreate(p_doc jsonb) returns text language sql as $t$
  select pg_temp.try_sql(pg_catalog.format('select public.zell_inv_create_purchase(%s, gen_random_uuid(), %s)', pg_temp.o(), pg_temp.j(p_doc)), 'service_role');
$t$;
create function pg_temp.epost(p_id bigint, p_v integer) returns text language sql as $t$
  select pg_temp.try_sql(pg_catalog.format('select public.zell_inv_post_purchase(%s, gen_random_uuid(), %s, %s)', pg_temp.o(), p_id, p_v), 'service_role');
$t$;
create function pg_temp.ecreate_opening(p_doc jsonb) returns text language sql as $t$
  select pg_temp.try_sql(pg_catalog.format('select public.zell_inv_create_opening(%s, gen_random_uuid(), %s)', pg_temp.o(), pg_temp.j(p_doc)), 'service_role');
$t$;

-- ═══ الـfixtures بالخصائص (قراءة بس — مفيش أي تعديل على products / product_widths / admin_users) ═══
do $pt_setup$
declare
  v_owner uuid;
  v_admin uuid;
  v_mw integer;
  v_mb integer;
  v_ma integer;
  v_m2 integer;
  v_m2b integer;
  v_pc integer;
  v_bad integer;
  v_iw_p integer;
  v_iw_w integer;
begin
  select u.user_id into v_owner from public.admin_users u
   where u.role = 'owner' and u.is_active order by u.created_at, u.user_id limit 1;
  select u.user_id into v_admin from public.admin_users u
   where u.role = 'admin' and u.is_active order by u.created_at, u.user_id limit 1;
  select p.id, p.width_cm,
         (select min(w.width_cm) from public.product_widths w
           where w.product_id = p.id and w.is_active and w.width_cm <> p.width_cm)
    into v_mw, v_mb, v_ma
    from public.products p
   where p.sale_unit = 'meter'
     and exists (select 1 from public.product_widths w
                  where w.product_id = p.id and w.is_active and w.width_cm <> p.width_cm)
   order by p.id limit 1;
  select p.id, p.width_cm into v_m2, v_m2b from public.products p
   where p.sale_unit = 'meter' and p.id is distinct from v_mw order by p.id limit 1;
  select p.id into v_pc from public.products p where p.sale_unit = 'piece' order by p.id limit 1;
  if v_owner is null or v_mw is null or v_m2 is null or v_pc is null then
    raise exception 'ZELL_0020_PTEST_FIXTURE_MISSING owner=% meter_w=% meter_2=% piece=%',
      v_owner is not null, v_mw is not null, v_m2 is not null, v_pc is not null;
  end if;
  select min(g) into v_bad from generate_series(1, 1000) g
   where g <> v_mb and not exists (select 1 from public.product_widths w
                                    where w.product_id = v_mw and w.is_active and w.width_cm = g);
  select w.product_id, w.width_cm into v_iw_p, v_iw_w
    from public.product_widths w join public.products p on p.id = w.product_id
   where p.sale_unit = 'meter' and not w.is_active and w.width_cm <> p.width_cm
   order by w.product_id, w.width_cm limit 1;
  perform pg_temp.set_ctx('OWNER', v_owner::text);
  perform pg_temp.set_ctx('ADMIN', v_admin::text);
  perform pg_temp.set_ctx('F_METER_W', v_mw::text);
  perform pg_temp.set_ctx('F_METER_W_BASE', v_mb::text);
  perform pg_temp.set_ctx('F_METER_W_ACTIVE', v_ma::text);
  perform pg_temp.set_ctx('F_METER_2', v_m2::text);
  perform pg_temp.set_ctx('F_METER_2_BASE', v_m2b::text);
  perform pg_temp.set_ctx('F_PIECE', v_pc::text);
  perform pg_temp.set_ctx('F_BAD_WIDTH', v_bad::text);
  perform pg_temp.set_ctx('F_INACTIVE_WIDTH_P', v_iw_p::text);
  perform pg_temp.set_ctx('F_INACTIVE_WIDTH_W', v_iw_w::text);
  perform pg_temp.set_ctx('MAIN', (select l.id from public.inventory_locations l where l.code = 'MAIN')::text);
end
$pt_setup$;


-- ═══ A. التثبيت، شكل الدور، وبروفات الإدارة والـrollback (قبل أي بيانات) ═══
do $pt_a$
declare
  v_ok boolean;
begin
  perform pg_temp.ok('A', 'body (migration + postflight) applied inside the transaction', true);
  perform pg_temp.ok('A', 'has_stock_refs is false before any data',
                     not public.zell_inv_product_has_stock_refs(pg_temp.ci('F_PIECE')::integer));
  perform pg_temp.expect_sql('A', 'postgres cannot DROP a definer-owned function without SET ROLE (no INHERIT)',
                             'drop function public.zell_inv_void_contract_version()', null, array['42501']);
  perform pg_temp.ok('A', 'membership rows: no inherit, has admin, has set',
    not exists (select 1 from pg_catalog.pg_auth_members m
                 where m.roleid = 'zell_inventory_definer'::regrole and m.member = 'postgres'::regrole and m.inherit_option)
    and exists (select 1 from pg_catalog.pg_auth_members m
                 where m.roleid = 'zell_inventory_definer'::regrole and m.member = 'postgres'::regrole and m.admin_option)
    and exists (select 1 from pg_catalog.pg_auth_members m
                 where m.roleid = 'zell_inventory_definer'::regrole and m.member = 'postgres'::regrole and m.set_option));
  perform pg_temp.ok('A', 'effective CREATE on schema public is false for the definer role',
                     not pg_catalog.has_schema_privilege('zell_inventory_definer', 'public', 'CREATE'));

  -- بروفة بروتوكول الإدارة (§2.1) — بترجع
  begin
    grant create on schema public to zell_inventory_definer;
    set local role zell_inventory_definer;
    create or replace function public.zell_inv_doc_void_blockers(p_source text, p_doc_id bigint)
      returns text[] language sql stable set search_path = '' as 'select ''{}''::text[]';
    revoke all on function public.zell_inv_doc_void_blockers(text, bigint) from public, anon, authenticated, service_role;
    grant execute on function public.zell_inv_allocate_lr(bigint, bigint[]) to service_role;
    revoke execute on function public.zell_inv_allocate_lr(bigint, bigint[]) from service_role;
    reset role;
    revoke create on schema public from zell_inventory_definer;
    v_ok := (select p.proowner = 'zell_inventory_definer'::regrole from pg_catalog.pg_proc p
              where p.oid = 'public.zell_inv_doc_void_blockers(text,bigint)'::regprocedure)
            and not pg_catalog.has_function_privilege('service_role', 'public.zell_inv_allocate_lr(bigint,bigint[])', 'EXECUTE')
            and not pg_catalog.has_schema_privilege('zell_inventory_definer', 'public', 'CREATE');
    raise exception using errcode = 'ZPT01';
  exception when others then
    if sqlstate = 'ZPT01' then
      perform pg_temp.ok('A', 'role management protocol rehearsal (SET LOCAL ROLE + temporary CREATE)', v_ok);
    else
      perform pg_temp.ok('A', 'role management protocol rehearsal (SET LOCAL ROLE + temporary CREATE)', false, sqlstate || ' ' || sqlerrm);
    end if;
  end;

  -- بروفة الـrollback الكاملة على schema فاضية — بترجع
  begin
    if pg_catalog.to_regrole('zell_inventory_definer') is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%') <> 43
     or (select count(*) from pg_catalog.pg_class c
          where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
            and c.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log')) <> 10 then
    raise exception 'ZELL_0020_ROLLBACK_NOT_FULLY_APPLIED';
  end if;
  if exists (select 1 from public.suppliers) or exists (select 1 from public.purchase_docs)
     or exists (select 1 from public.purchase_doc_lines) or exists (select 1 from public.purchase_doc_charges)
     or exists (select 1 from public.opening_stock_docs) or exists (select 1 from public.opening_stock_lines)
     or exists (select 1 from public.stock_lots) or exists (select 1 from public.inventory_commands)
     or exists (select 1 from public.inventory_audit_log)
     or (select count(*) from public.inventory_locations) <> 1
     or not exists (select 1 from public.inventory_locations l where l.code = 'MAIN' and l.is_default and l.is_active) then
    raise exception 'ZELL_0020_ROLLBACK_HAS_DATA';
  end if;
    drop trigger zinv_products_sale_unit on public.products;
alter table public.purchase_doc_lines drop constraint purchase_doc_lines_product_fk;
alter table public.opening_stock_lines drop constraint opening_stock_lines_product_fk;
alter table public.stock_lots drop constraint stock_lots_product_fk;

-- الدوال المملوكة لـ zell_inventory_definer: 23 RPC + 8 دوال مساعدة = 31 (تحت SET LOCAL ROLE — مفيش INHERIT)
set local role zell_inventory_definer;
drop function public.zell_inv_create_location(uuid, uuid, text, text);
drop function public.zell_inv_update_location(uuid, uuid, bigint, integer, text, boolean);
drop function public.zell_inv_create_supplier(uuid, uuid, text, text, text);
drop function public.zell_inv_update_supplier(uuid, uuid, bigint, integer, text, text, text, boolean);
drop function public.zell_inv_create_purchase(uuid, uuid, jsonb);
drop function public.zell_inv_update_purchase(uuid, uuid, bigint, integer, jsonb);
drop function public.zell_inv_post_purchase(uuid, uuid, bigint, integer);
drop function public.zell_inv_discard_purchase(uuid, uuid, bigint, integer, text);
drop function public.zell_inv_void_purchase(uuid, uuid, bigint, integer, text);
drop function public.zell_inv_create_opening(uuid, uuid, jsonb);
drop function public.zell_inv_update_opening(uuid, uuid, bigint, integer, jsonb);
drop function public.zell_inv_post_opening(uuid, uuid, bigint, integer);
drop function public.zell_inv_discard_opening(uuid, uuid, bigint, integer, text);
drop function public.zell_inv_void_opening(uuid, uuid, bigint, integer, text);
drop function public.zell_inv_list_locations(uuid, boolean, integer, bigint);
drop function public.zell_inv_list_suppliers(uuid, boolean, integer, text);
drop function public.zell_inv_list_purchases(uuid, text, bigint, integer, bigint);
drop function public.zell_inv_get_purchase(uuid, bigint);
drop function public.zell_inv_preview_purchase(uuid, jsonb);
drop function public.zell_inv_list_openings(uuid, text, integer, bigint);
drop function public.zell_inv_get_opening(uuid, bigint);
drop function public.zell_inv_preview_opening(uuid, jsonb);
drop function public.zell_inv_list_lots(uuid, text, integer, bigint, integer, bigint);
drop function public.zell_inv_width_allowed(integer, integer[], integer);
drop function public.zell_inv_allocate_lr(bigint, bigint[]);
drop function public.zell_inv_normalize_purchase(jsonb);
drop function public.zell_inv_normalize_opening(jsonb);
drop function public.zell_inv_command_check(uuid, uuid, text, text);
drop function public.zell_inv_doc_void_blockers(text, bigint);
drop function public.zell_inv_unknown_lot_references();
drop function public.zell_inv_void_contract_version();
reset role;

drop table public.stock_lots;
drop table public.purchase_doc_lines;
drop table public.purchase_doc_charges;
drop table public.opening_stock_lines;
drop table public.purchase_docs;
drop table public.opening_stock_docs;
drop table public.suppliers;
drop table public.inventory_locations;
drop table public.inventory_audit_log;
drop table public.inventory_commands;
drop sequence public.purchase_doc_no_seq;
drop sequence public.opening_doc_no_seq;
drop sequence public.roll_lot_seq;
drop sequence public.batch_lot_seq;

-- الدوال المملوكة لـ postgres: 4 دوال مساعدة (3 مسموحة للدور + has_stock_refs) + 8 دوال triggers
drop function public.zell_inv_assert_owner(uuid);
drop function public.zell_inv_lock_products(integer[]);
drop function public.zell_inv_read_products(integer[]);
drop function public.zell_inv_product_has_stock_refs(integer);
drop function public.zell_inv_trg_no_delete();
drop function public.zell_inv_trg_no_truncate();
drop function public.zell_inv_trg_doc_guard();
drop function public.zell_inv_trg_child_insert_guard();
drop function public.zell_inv_trg_append_only();
drop function public.zell_inv_trg_lot_update_guard();
drop function public.zell_inv_trg_master_guard();
drop function public.zell_inv_trg_products_sale_unit();

revoke usage on schema public from zell_inventory_definer;
drop role zell_inventory_definer;
    if pg_catalog.to_regrole('zell_inventory_definer') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                 where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%')
     or exists (select 1 from pg_catalog.pg_class c
                 where c.relnamespace = 'public'::regnamespace
                   and c.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log', 'purchase_doc_no_seq', 'opening_doc_no_seq', 'roll_lot_seq', 'batch_lot_seq'))
     or (select coalesce(string_agg(g.tgname::text, ',' order by g.tgname), '')
           from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid = g.tgrelid
          where c.relnamespace = 'public'::regnamespace and not g.tgisinternal) <> 'orders_cancelled_final' then
    raise exception 'ZELL_0020_ROLLBACK_INCOMPLETE';
  end if;
    raise exception using errcode = 'ZPT01';
  exception when others then
    perform pg_temp.ok('A', 'full rollback rehearsal on empty schema (incl. DROP ROLE)', sqlstate = 'ZPT01',
                       case when sqlstate = 'ZPT01' then null else sqlstate || ' ' || sqlerrm end);
  end;
  perform pg_temp.ok('A', 'objects still present after rehearsal revert',
                     pg_catalog.to_regrole('zell_inventory_definer') is not null
                     and pg_catalog.to_regclass('public.stock_lots') is not null);
exception when others then
  perform pg_temp.ok('A', 'group crashed', false, sqlstate || ' ' || sqlerrm);
end
$pt_a$;


-- ═══ B. الصلاحيات: caller DB role مقابل business actor ═══
do $pt_b$
declare
  v_t text;
  v_call text;
  v_actor text;
  v_actors text[];
  v_calls text[] := array[
    'public.zell_inv_create_location(%1$s, gen_random_uuid(), ''ZZ'', ''x'')',
    'public.zell_inv_update_location(%1$s, gen_random_uuid(), 1, 1, ''x'', true)',
    'public.zell_inv_create_supplier(%1$s, gen_random_uuid(), ''x'', null, null)',
    'public.zell_inv_update_supplier(%1$s, gen_random_uuid(), 1, 1, ''x'', null, null, true)',
    'public.zell_inv_create_purchase(%1$s, gen_random_uuid(), ''{}''::jsonb)',
    'public.zell_inv_update_purchase(%1$s, gen_random_uuid(), 1, 1, ''{}''::jsonb)',
    'public.zell_inv_post_purchase(%1$s, gen_random_uuid(), 1, 1)',
    'public.zell_inv_discard_purchase(%1$s, gen_random_uuid(), 1, 1, null)',
    'public.zell_inv_void_purchase(%1$s, gen_random_uuid(), 1, 1, ''xxx'')',
    'public.zell_inv_create_opening(%1$s, gen_random_uuid(), ''{}''::jsonb)',
    'public.zell_inv_update_opening(%1$s, gen_random_uuid(), 1, 1, ''{}''::jsonb)',
    'public.zell_inv_post_opening(%1$s, gen_random_uuid(), 1, 1)',
    'public.zell_inv_discard_opening(%1$s, gen_random_uuid(), 1, 1, null)',
    'public.zell_inv_void_opening(%1$s, gen_random_uuid(), 1, 1, ''xxx'')',
    'public.zell_inv_list_locations(%1$s, true, 25, null)',
    'public.zell_inv_list_suppliers(%1$s, true, 25, null)',
    'public.zell_inv_list_purchases(%1$s, null, null, 25, null)',
    'public.zell_inv_get_purchase(%1$s, 1)',
    'public.zell_inv_preview_purchase(%1$s, ''{}''::jsonb)',
    'public.zell_inv_list_openings(%1$s, null, 25, null)',
    'public.zell_inv_get_opening(%1$s, 1)',
    'public.zell_inv_preview_opening(%1$s, ''{}''::jsonb)',
    'public.zell_inv_list_lots(%1$s, ''active'', null, null, 25, null)'];
begin
  perform pg_temp.ok('B', '23 RPC call templates', array_length(v_calls, 1) = 23);
  foreach v_t in array array['inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log'] loop
    perform pg_temp.expect_sql('B', 'service_role cannot SELECT ' || v_t,
                               'select 1 from public.' || v_t || ' limit 1', 'service_role', array['42501']);
  end loop;
  perform pg_temp.expect_sql('B', 'service_role cannot call allocate_lr',
                             'select public.zell_inv_allocate_lr(1, array[1]::bigint[])', 'service_role', array['42501']);
  perform pg_temp.expect_sql('B', 'service_role cannot call assert_owner',
                             pg_catalog.format('select public.zell_inv_assert_owner(%s)', pg_temp.o()), 'service_role', array['42501']);
  perform pg_temp.expect_sql('B', 'service_role cannot call has_stock_refs',
                             'select public.zell_inv_product_has_stock_refs(1)', 'service_role', array['42501']);
  perform pg_temp.expect_sql('B', 'service_role cannot call lock_products',
                             'select * from public.zell_inv_lock_products(array[1])', 'service_role', array['42501']);
  perform pg_temp.ok('B', 'anon/authenticated have no EXECUTE on any zell_inv_* (catalog)',
    not exists (select 1 from pg_catalog.pg_proc p
                 where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%'
                   and (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                        or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))));

  v_actors := array[quote_literal(gen_random_uuid()::text) || '::uuid', 'null::uuid'];
  if pg_temp.c('ADMIN') is not null then
    v_actors := v_actors || (quote_literal(pg_temp.c('ADMIN')) || '::uuid');
  else
    perform pg_temp.mark('B', 'admin actor cases', 'SKIP', 'no active admin user');
  end if;
  foreach v_actor in array v_actors loop
    foreach v_call in array v_calls loop
      perform pg_temp.expect('B', 'non-owner actor reaches RPC and gets 45200: ' || split_part(v_call, '(', 1) || ' / ' || left(v_actor, 12),
                             pg_catalog.format(v_call, v_actor), array['45200']);
    end loop;
  end loop;
exception when others then
  perform pg_temp.ok('B', 'group crashed', false, sqlstate || ' ' || sqlerrm);
end
$pt_b$;


-- ═══ C. التحقق ═══
do $pt_c$
declare
  v_r jsonb;
  v_mw bigint := pg_temp.ci('F_METER_W');
  v_mb bigint := pg_temp.ci('F_METER_W_BASE');
  v_ma bigint := pg_temp.ci('F_METER_W_ACTIVE');
  v_m2 bigint := pg_temp.ci('F_METER_2');
  v_m2b bigint := pg_temp.ci('F_METER_2_BASE');
  v_pc bigint := pg_temp.ci('F_PIECE');
  v_bad bigint := pg_temp.ci('F_BAD_WIDTH');
  v_ok_line jsonb;
  v_s2 bigint;
  v_l2 bigint;
  v_tomorrow text := to_char((now() at time zone 'Africa/Cairo')::date + 1, 'YYYY-MM-DD');
begin
  v_ok_line := pg_temp.batch(v_pc, 1, 1000);

  -- الموردين
  v_r := pg_temp.rpc(pg_catalog.format('public.zell_inv_create_supplier(%s, gen_random_uuid(), %L, %L, null)',
                     pg_temp.o(), 'مورد اختبار ptest', '+20 100-000-0000'));
  perform pg_temp.set_ctx('S1', v_r ->> 'supplierId');
  perform pg_temp.ok('C', 'supplier created with version 1 and normalized phone',
    (v_r ->> 'version')::integer = 1
    and (select s.phone from public.suppliers s where s.id = (v_r ->> 'supplierId')::bigint) = '+201000000000');
  perform pg_temp.expect('C', 'duplicate supplier name after normalization → 45218',
    pg_catalog.format('public.zell_inv_create_supplier(%s, gen_random_uuid(), %L, null, null)', pg_temp.o(), '  مورد   اختبار PTEST '),
    array['45218']);
  perform pg_temp.expect('C', 'bad phone → 45203',
    pg_catalog.format('public.zell_inv_create_supplier(%s, gen_random_uuid(), %L, %L, null)', pg_temp.o(), 'مورد آخر', '12ab'),
    array['45203']);

  -- شكل الـpayload
  perform pg_temp.expect('C', 'unknown top-level key → 45203',
    pg_catalog.format('public.zell_inv_create_purchase(%s, gen_random_uuid(), %s)', pg_temp.o(),
                      pg_temp.j(pg_temp.pdoc(jsonb_build_array(v_ok_line)) || '{"foo": 1}')), array['45203']);
  perform pg_temp.ok('C', 'lineTotal as string → 45203',
    pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(jsonb_set(v_ok_line, '{lineTotalPiastres}', '"1000"')))) = '45203');
  perform pg_temp.ok('C', 'fractional amount → 45203',
    pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(jsonb_set(v_ok_line, '{lineTotalPiastres}', '1000.5')))) = '45203');
  perform pg_temp.ok('C', 'negative amount → 45203',
    pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(jsonb_set(v_ok_line, '{lineTotalPiastres}', '-1')))) = '45203');
  perform pg_temp.ok('C', '101 lines → 45203',
    pg_temp.ecreate(pg_temp.pdoc((select jsonb_agg(v_ok_line) from generate_series(1, 101)))) = '45203');
  perform pg_temp.ok('C', '201 rolls in one line → 45203',
    pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(pg_temp.roll(v_mw, v_mb, array(select 100 from generate_series(1, 201)), 1000)))) = '45203');
  perform pg_temp.ok('C', 'more than 200 lots in a document → 45203',
    pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(
      pg_temp.roll(v_mw, v_mb, array(select 100 from generate_series(1, 101)), 1000),
      pg_temp.roll(v_mw, v_mb, array(select 100 from generate_series(1, 100)), 1000)))) = '45203');
  perform pg_temp.ok('C', 'payload over 128KB → 45203',
    pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(v_ok_line), p_note => repeat('ز', 140000))) = '45203');
  perform pg_temp.ok('C', 'other charge without note → 45203',
    pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(v_ok_line), jsonb_build_array(pg_temp.charge('other', 100)))) = '45203');

  -- الوحدة والعرض
  perform pg_temp.ok('C', 'roll line on a piece product → 45206',
    pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(pg_temp.roll(v_pc, 50, array[100], 1000)))) = '45206');
  perform pg_temp.ok('C', 'batch line on a meter product → 45206',
    pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_m2, 1, 1000)))) = '45206');
  perform pg_temp.ok('C', 'nonexistent product → 45206',
    pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(2147483000, 1, 1000)))) = '45206');
  perform pg_temp.ok('C', 'width not base and not an active product_widths row → 45207',
    pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(pg_temp.roll(v_mw, v_bad, array[100], 1000)))) = '45207');
  perform pg_temp.ok('C', 'base width accepted', pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(pg_temp.roll(v_mw, v_mb, array[100], 1000)))) = 'OK');
  perform pg_temp.ok('C', 'active extra width accepted', pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(pg_temp.roll(v_mw, v_ma, array[100], 1000)))) = 'OK');
  if pg_temp.c('F_INACTIVE_WIDTH_P') is not null then
    perform pg_temp.ok('C', 'real inactive product_widths row → 45207',
      pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(pg_temp.roll(pg_temp.ci('F_INACTIVE_WIDTH_P'), pg_temp.ci('F_INACTIVE_WIDTH_W'), array[100], 1000)))) = '45207');
  else
    perform pg_temp.mark('C', 'real inactive product_widths row → 45207', 'SKIP', 'no inactive product_widths row exists');
  end if;
  set local role zell_inventory_definer;
  v_r := jsonb_build_array(public.zell_inv_width_allowed(50, '{100}', 120), public.zell_inv_width_allowed(50, '{100}', 100),
                           public.zell_inv_width_allowed(50, '{}', 50), public.zell_inv_width_allowed(50, '{100}', null));
  reset role;
  perform pg_temp.ok('C', 'width_allowed synthetic: inactive 120 rejected, active 100 and base 50 accepted', v_r = '[false, true, true, false]'::jsonb);

  -- قواعد الصفر
  perform pg_temp.ok('C', 'zero cost without reason → 45215', pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 0)))) = '45215');
  perform pg_temp.ok('C', 'reason with non-zero cost → 45215', pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 10, 'هدية')))) = '45215');

  -- التاريخ
  perform pg_temp.ok('C', 'future date (Cairo) → 45221', pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(v_ok_line), p_date => v_tomorrow)) = '45221');
  perform pg_temp.ok('C', 'very old date accepted (no lower bound)', pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(v_ok_line), p_date => '1999-01-01')) = 'OK');
  perform pg_temp.ok('C', 'invalid calendar date → 45203', pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(v_ok_line), p_date => '2026-02-30')) = '45203');

  -- مورد وموقع موقوفين
  v_r := pg_temp.rpc(pg_catalog.format('public.zell_inv_create_supplier(%s, gen_random_uuid(), %L, null, null)', pg_temp.o(), 'مورد موقوف ptest'));
  v_s2 := (v_r ->> 'supplierId')::bigint;
  perform pg_temp.rpc(pg_catalog.format('public.zell_inv_update_supplier(%s, gen_random_uuid(), %s, 1, %L, null, null, false)', pg_temp.o(), v_s2, 'مورد موقوف ptest'));
  perform pg_temp.ok('C', 'inactive supplier → 45204', pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(v_ok_line), p_supplier => v_s2)) = '45204');
  v_r := pg_temp.rpc(pg_catalog.format('public.zell_inv_create_location(%s, gen_random_uuid(), %L, %L)', pg_temp.o(), 'PTL2', 'مخزن اختبار'));
  v_l2 := (v_r ->> 'locationId')::bigint;
  perform pg_temp.set_ctx('L2', v_l2::text);
  perform pg_temp.expect('C', 'duplicate location code → 45219',
    pg_catalog.format('public.zell_inv_create_location(%s, gen_random_uuid(), %L, %L)', pg_temp.o(), 'PTL2', 'تاني'), array['45219']);
  perform pg_temp.rpc(pg_catalog.format('public.zell_inv_update_location(%s, gen_random_uuid(), %s, 1, %L, false)', pg_temp.o(), v_l2, 'مخزن اختبار'));
  perform pg_temp.ok('C', 'inactive location → 45205', pg_temp.ecreate(pg_temp.pdoc(jsonb_build_array(v_ok_line), p_location => v_l2)) = '45205');

  -- فلاتر القراءة والحدود
  perform pg_temp.expect('C', 'list_lots without status → 45203',
    pg_catalog.format('public.zell_inv_list_lots(%s, null, null, null, 25, null)', pg_temp.o()), array['45203']);
  perform pg_temp.expect('C', 'list limit 101 → 45203',
    pg_catalog.format('public.zell_inv_list_purchases(%s, null, null, 101, null)', pg_temp.o()), array['45203']);
  perform pg_temp.expect('C', 'unknown status filter → 45203',
    pg_catalog.format('public.zell_inv_list_purchases(%s, %L, null, 25, null)', pg_temp.o(), 'bogus'), array['45203']);
  perform pg_temp.ok('C', 'list default limit is 25 and returns a nextBeforeId field',
    (pg_temp.rpc(pg_catalog.format('public.zell_inv_list_purchases(%s, null, null, null, null)', pg_temp.o()))) ? 'nextBeforeId');
exception when others then
  perform pg_temp.ok('C', 'group crashed', false, sqlstate || ' ' || sqlerrm);
end
$pt_c$;


-- ═══ D. التوزيع ═══
do $pt_d$
declare
  v_r jsonb;
  v_doc bigint;
  v_landed jsonb;
  v_mw bigint := pg_temp.ci('F_METER_W');
  v_ma bigint := pg_temp.ci('F_METER_W_ACTIVE');
  v_pc bigint := pg_temp.ci('F_PIECE');
  v_a jsonb;
  -- اختبار الخواص
  v_case integer;
  v_n integer;
  v_w bigint[];
  v_t bigint;
  v_alloc bigint[];
  v_wsum numeric;
  v_kq numeric;
  v_bad_rows integer;
  v_fail integer := 0;
begin
  -- D1: allocate_lr بالأرقام بالظبط
  set local role zell_inventory_definer;
  v_a := jsonb_build_array(
    to_jsonb(public.zell_inv_allocate_lr(1000000, array[3000, 3000, 1000]::bigint[])),
    to_jsonb(public.zell_inv_allocate_lr(37000, array[428572, 428571, 142857, 250000]::bigint[])),
    to_jsonb(public.zell_inv_allocate_lr(5000, array[428572, 428571, 142857, 250000]::bigint[])),
    to_jsonb(public.zell_inv_allocate_lr(1, array[100, 100]::bigint[])),
    to_jsonb(public.zell_inv_allocate_lr(0, array[0, 0]::bigint[])));
  reset role;
  perform pg_temp.ok('D', 'allocate_lr exact contract examples',
    v_a = '[[428572, 428571, 142857], [12686, 12686, 4228, 7400], [1714, 1714, 572, 1000], [1, 0], [0, 0]]'::jsonb, v_a::text);
  perform pg_temp.expect_sql('D', 'allocate_lr with zero weights and positive total → 45210',
    'select public.zell_inv_allocate_lr(5, array[0, 0]::bigint[])', 'zell_inventory_definer', array['45210']);

  -- D2: مثال العقد كامل (create → post)
  v_r := pg_temp.create_purchase(pg_temp.pdoc(
    jsonb_build_array(pg_temp.roll(v_mw, v_ma, array[3000, 3000, 1000], 1000000), pg_temp.batch(v_pc, 50, 250000)),
    jsonb_build_array(pg_temp.charge('transport', 20000, 'نقل من المصنع'), pg_temp.charge('transport', 10000, 'نقل داخلي'),
                      pg_temp.charge('loading', 7000)),
    5000, pg_temp.ci('S1')));
  v_doc := (v_r ->> 'docId')::bigint;
  v_r := pg_temp.post_purchase(v_doc, 1);
  perform pg_temp.set_ctx('D2', v_doc::text);
  perform pg_temp.set_ctx('D2_V', v_r ->> 'version');
  select jsonb_agg(s.landed_cost_piastres order by x.line_no, s.lot_sequence) into v_landed
    from public.stock_lots s join public.purchase_doc_lines x on x.id = s.purchase_line_id where x.doc_id = v_doc;
  perform pg_temp.ok('D', 'contract example: landed per lot = 439544, 439543, 146513, 256400',
                     v_landed = '[439544, 439543, 146513, 256400]'::jsonb, v_landed::text);
  perform pg_temp.ok('D', 'contract example: totals V=1250000 E=37000 D=5000 total=1282000 and 3 charge rows',
    exists (select 1 from public.purchase_docs d where d.id = v_doc and d.items_subtotal_piastres = 1250000
             and d.extras_total_piastres = 37000 and d.supplier_discount_piastres = 5000 and d.total_cost_piastres = 1282000
             and d.charge_count = 3 and d.lot_count = 4)
    and (select count(*) from public.purchase_doc_charges c where c.doc_id = v_doc) = 3);

  -- D3/D4: حالات الرفض عند الترحيل
  v_r := pg_temp.create_purchase(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 0, 'هدية من المورد')),
                                              jsonb_build_array(pg_temp.charge('transport', 100))));
  perform pg_temp.ok('D', 'V=0 with charges → 45210 at post', pg_temp.epost((v_r ->> 'docId')::bigint, 1) = '45210');
  v_r := pg_temp.create_purchase(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 1000)), '[]'::jsonb, 1000));
  perform pg_temp.ok('D', 'D = V → 45211 at post', pg_temp.epost((v_r ->> 'docId')::bigint, 1) = '45211');
  v_r := pg_temp.create_purchase(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 1000)), '[]'::jsonb, 2000));
  perform pg_temp.ok('D', 'D > V → 45211 at post', pg_temp.epost((v_r ->> 'docId')::bigint, 1) = '45211');
  v_r := pg_temp.create_purchase(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 1000))));
  perform pg_temp.rpc(pg_catalog.format('public.zell_inv_update_purchase(%s, gen_random_uuid(), %s, 1, %s)', pg_temp.o(),
                      v_r ->> 'docId', pg_temp.j(pg_temp.pdoc('[]'::jsonb))));
  perform pg_temp.ok('D', 'posting a zero-line draft → 45209', pg_temp.epost((v_r ->> 'docId')::bigint, 2) = '45209');

  -- D5: مستند مجاني بالكامل
  v_r := pg_temp.create_purchase(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 2, 0, 'عينات مجانية'))));
  v_r := pg_temp.post_purchase((v_r ->> 'docId')::bigint, 1);
  perform pg_temp.ok('D', 'fully free document posts with zero landed cost',
    (v_r -> 'lots' -> 0 ->> 'landedCostPiastres')::bigint = 0 and (v_r -> 'totals' ->> 'totalCostPiastres')::bigint = 0);

  -- D6: اختبار خواص على 2,000 حالة (دالة صافية، من غير كتابة)
  perform setseed(0.42);
  set local role zell_inventory_definer;
  for v_case in 1 .. 2000 loop
    v_n := 1 + floor(random() * 20)::integer;
    v_w := array(select case when random() < 0.15 then 0 else floor(random() * 10000000000)::bigint end
                   from generate_series(1, v_n));
    if (select sum(x) from unnest(v_w) as x) = 0 then
      v_w[1] := 1 + floor(random() * 1000)::bigint;
    end if;
    v_t := floor(random() * 10000000000)::bigint;
    v_alloc := public.zell_inv_allocate_lr(v_t, v_w);
    v_wsum := (select sum(x) from unnest(v_w) as x);
    if (select sum(x) from unnest(v_alloc) as x) <> v_t or array_length(v_alloc, 1) <> v_n then
      v_fail := v_fail + 1;
      continue;
    end if;
    v_kq := v_t - (select sum(div(v_t::numeric * x, v_wsum)) from unnest(v_w) as x);
    select count(*) into v_bad_rows from (
      select z.ai, z.qi, row_number() over (order by z.ri desc, z.ord asc) as rk
        from (select u.ord, v_alloc[u.ord::integer] as ai, div(v_t::numeric * u.wi, v_wsum) as qi, mod(v_t::numeric * u.wi, v_wsum) as ri
                from unnest(v_w) with ordinality as u(wi, ord)) z
    ) y
     where not ((y.rk <= v_kq and y.ai = y.qi + 1) or (y.rk > v_kq and y.ai = y.qi));
    if v_bad_rows > 0 then
      v_fail := v_fail + 1;
    end if;
  end loop;
  reset role;
  perform pg_temp.ok('D', 'property test: 2000 random cases satisfy the largest-remainder characterization', v_fail = 0, 'failures=' || v_fail);
exception when others then
  perform pg_temp.ok('D', 'group crashed', false, sqlstate || ' ' || sqlerrm);
end
$pt_d$;


-- ═══ E. دورة الحياة واللقطات ═══
do $pt_e$
declare
  v_r jsonb;
  v_e bigint;
  v_f bigint;
  v_pc bigint := pg_temp.ci('F_PIECE');
  v_mw bigint := pg_temp.ci('F_METER_W');
  v_mb bigint := pg_temp.ci('F_METER_W_BASE');
  v_s1 bigint := pg_temp.ci('S1');
  v_s1name text;
begin
  v_r := pg_temp.create_purchase(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 3, 3000)), p_supplier => v_s1));
  v_e := (v_r ->> 'docId')::bigint;
  perform pg_temp.ok('E', 'create returns draft v1 with PUR- number',
                     v_r ->> 'status' = 'draft' and (v_r ->> 'version')::integer = 1 and v_r ->> 'docNo' ~ '^PUR-[0-9]{6,}$');
  v_r := pg_temp.rpc(pg_catalog.format('public.zell_inv_update_purchase(%s, gen_random_uuid(), %s, 1, %s)', pg_temp.o(), v_e,
         pg_temp.j(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 4, 4000), pg_temp.roll(v_mw, v_mb, array[500], 5000)), p_supplier => v_s1))));
  perform pg_temp.ok('E', 'update bumps version to 2', (v_r ->> 'version')::integer = 2);
  perform pg_temp.expect('E', 'stale version on update → 45202',
    pg_catalog.format('public.zell_inv_update_purchase(%s, gen_random_uuid(), %s, 1, %s)', pg_temp.o(), v_e,
                      pg_temp.j(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 100))))), array['45202']);
  v_r := pg_temp.post_purchase(v_e, 2);
  perform pg_temp.ok('E', 'post: status posted, version 3, payload NULL, snapshots set, 2 lots',
    v_r ->> 'status' = 'posted' and (v_r ->> 'version')::integer = 3
    and exists (select 1 from public.purchase_docs d
                 where d.id = v_e and d.draft_payload is null and d.lot_count = 2 and d.line_count = 2
                   and d.supplier_name_snapshot = (select s.name from public.suppliers s where s.id = v_s1)
                   and d.location_name_snapshot = 'المخزن الرئيسي'));
  perform pg_temp.ok('E', 'post again (fresh command, current version) → 45208', pg_temp.epost(v_e, 3) = '45208');
  perform pg_temp.expect('E', 'update after post → 45208',
    pg_catalog.format('public.zell_inv_update_purchase(%s, gen_random_uuid(), %s, 3, %s)', pg_temp.o(), v_e,
                      pg_temp.j(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 100))))), array['45208']);
  perform pg_temp.expect('E', 'discard posted → 45208',
    pg_catalog.format('public.zell_inv_discard_purchase(%s, gen_random_uuid(), %s, 3, null)', pg_temp.o(), v_e), array['45208']);
  perform pg_temp.expect('E', 'void reason shorter than 3 → 45203',
    pg_catalog.format('public.zell_inv_void_purchase(%s, gen_random_uuid(), %s, 3, %L)', pg_temp.o(), v_e, 'ab'), array['45203']);

  v_r := pg_temp.create_purchase(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 100))));
  v_f := (v_r ->> 'docId')::bigint;
  perform pg_temp.expect('E', 'void a draft → 45214',
    pg_catalog.format('public.zell_inv_void_purchase(%s, gen_random_uuid(), %s, 1, %L)', pg_temp.o(), v_f, 'سبب كافي'), array['45214']);
  v_r := pg_temp.rpc(pg_catalog.format('public.zell_inv_discard_purchase(%s, gen_random_uuid(), %s, 1, %L)', pg_temp.o(), v_f, 'مسودة غلط'));
  perform pg_temp.ok('E', 'discard draft → discarded v2, payload kept',
    v_r ->> 'status' = 'discarded' and (v_r ->> 'version')::integer = 2
    and exists (select 1 from public.purchase_docs d where d.id = v_f and d.draft_payload is not null));
  perform pg_temp.ok('E', 'post a discarded doc → 45208', pg_temp.epost(v_f, 2) = '45208');
  perform pg_temp.expect('E', 'void a discarded doc → 45214',
    pg_catalog.format('public.zell_inv_void_purchase(%s, gen_random_uuid(), %s, 2, %L)', pg_temp.o(), v_f, 'سبب كافي'), array['45214']);

  v_r := pg_temp.rpc(pg_catalog.format('public.zell_inv_void_purchase(%s, gen_random_uuid(), %s, 3, %L)', pg_temp.o(), v_e, 'خطأ إدخال'));
  perform pg_temp.ok('E', 'void posted → voided v4, document first then all lots voided',
    v_r ->> 'status' = 'voided' and (v_r ->> 'version')::integer = 4 and (v_r ->> 'voidedLots')::integer = 2
    and not exists (select 1 from public.stock_lots s join public.purchase_doc_lines x on x.id = s.purchase_line_id
                     where x.doc_id = v_e and s.status <> 'voided'));
  perform pg_temp.expect('E', 'void a voided doc → 45214',
    pg_catalog.format('public.zell_inv_void_purchase(%s, gen_random_uuid(), %s, 4, %L)', pg_temp.o(), v_e, 'سبب كافي'), array['45214']);
  perform pg_temp.expect('E', 'get nonexistent → 45201',
    pg_catalog.format('public.zell_inv_get_purchase(%s, -1)', pg_temp.o()), array['45201']);

  -- ثبات اللقطات بعد تعديل اسم المورد واسم MAIN
  select s.name into v_s1name from public.suppliers s where s.id = v_s1;
  perform pg_temp.rpc(pg_catalog.format('public.zell_inv_update_supplier(%s, gen_random_uuid(), %s, %s, %L, null, null, true)',
                      pg_temp.o(), v_s1, (select s.version from public.suppliers s where s.id = v_s1), 'اسم جديد للمورد ptest'));
  perform pg_temp.rpc(pg_catalog.format('public.zell_inv_update_location(%s, gen_random_uuid(), %s, %s, %L, true)',
                      pg_temp.o(), pg_temp.ci('MAIN'), (select l.version from public.inventory_locations l where l.code = 'MAIN'), 'المخزن الرئيسي (معدّل)'));
  v_r := pg_temp.rpc(pg_catalog.format('public.zell_inv_get_purchase(%s, %s)', pg_temp.o(), pg_temp.ci('D2')));
  perform pg_temp.ok('E', 'posted snapshots unchanged after renaming supplier and MAIN',
    v_r -> 'header' ->> 'supplierName' = v_s1name and v_r -> 'header' ->> 'locationName' = 'المخزن الرئيسي'
    and jsonb_array_length(v_r -> 'lots') = 4 and jsonb_array_length(v_r -> 'charges') = 3);
  perform pg_temp.ok('E', 'MAIN rename allowed (name only)',
    exists (select 1 from public.inventory_locations l where l.code = 'MAIN' and l.name = 'المخزن الرئيسي (معدّل)' and l.is_default));
  perform pg_temp.expect('E', 'deactivating MAIN via RPC → 45220',
    pg_catalog.format('public.zell_inv_update_location(%s, gen_random_uuid(), %s, %s, %L, false)', pg_temp.o(), pg_temp.ci('MAIN'),
                      (select l.version from public.inventory_locations l where l.code = 'MAIN'), 'x'), array['45220']);
exception when others then
  perform pg_temp.ok('E', 'group crashed', false, sqlstate || ' ' || sqlerrm);
end
$pt_e$;


-- ═══ I. الـreplay وإعادة الشبكة ═══
do $pt_i$
declare
  v_cmd uuid := gen_random_uuid();
  v_cmd2 uuid := gen_random_uuid();
  v_cmd3 uuid := gen_random_uuid();
  v_cmd4 uuid := gen_random_uuid();
  v_doc jsonb;
  v_r1 jsonb;
  v_r2 jsonb;
  v_audit bigint;
  v_lots bigint;
  v_id bigint;
  v_pc bigint := pg_temp.ci('F_PIECE');
  v_mw bigint := pg_temp.ci('F_METER_W');
  v_mb bigint := pg_temp.ci('F_METER_W_BASE');
  v_bad bigint := pg_temp.ci('F_BAD_WIDTH');
begin
  v_doc := pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 1500)));
  v_r1 := pg_temp.rpc(pg_catalog.format('public.zell_inv_create_purchase(%s, %L::uuid, %s)', pg_temp.o(), v_cmd, pg_temp.j(v_doc)));
  select count(*) into v_audit from public.inventory_audit_log;
  v_r2 := pg_temp.rpc(pg_catalog.format('public.zell_inv_create_purchase(%s, %L::uuid, %s)', pg_temp.o(), v_cmd, pg_temp.j(v_doc)));
  perform pg_temp.ok('I', 'same command + same payload → replay with same docId, no new audit',
    (v_r2 ->> 'replayed')::boolean and v_r2 ->> 'docId' = v_r1 ->> 'docId'
    and (select count(*) from public.inventory_audit_log) = v_audit);
  perform pg_temp.expect('I', 'same command + different payload → 45212',
    pg_catalog.format('public.zell_inv_create_purchase(%s, %L::uuid, %s)', pg_temp.o(), v_cmd,
                      pg_temp.j(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 2, 1500))))), array['45212']);
  perform pg_temp.expect('I', 'same command + different kind → 45212',
    pg_catalog.format('public.zell_inv_create_supplier(%s, %L::uuid, %L, null, null)', pg_temp.o(), v_cmd, 'مورد replay'), array['45212']);

  -- نفس المعنى بتطبيع مختلف (مسافات + NFD) = replay
  v_r1 := pg_temp.rpc(pg_catalog.format('public.zell_inv_create_purchase(%s, %L::uuid, %s)', pg_temp.o(), v_cmd2,
                      pg_temp.j(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 1500)), p_note => 'caf' || chr(233)))));
  v_r2 := pg_temp.rpc(pg_catalog.format('public.zell_inv_create_purchase(%s, %L::uuid, %s)', pg_temp.o(), v_cmd2,
                      pg_temp.j(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 1500)), p_note => '  cafe' || chr(769) || '  '))));
  perform pg_temp.ok('I', 'same meaning with different Unicode form and spaces → replay',
    (v_r2 ->> 'replayed')::boolean and v_r2 ->> 'docId' = v_r1 ->> 'docId');

  -- فشل ثم إعادة بنفس المفتاح بعد التصليح
  perform pg_temp.expect('I', 'first attempt fails (bad width) → 45207',
    pg_catalog.format('public.zell_inv_create_purchase(%s, %L::uuid, %s)', pg_temp.o(), v_cmd3,
                      pg_temp.j(pg_temp.pdoc(jsonb_build_array(pg_temp.roll(v_mw, v_bad, array[100], 100))))), array['45207']);
  v_r1 := pg_temp.rpc(pg_catalog.format('public.zell_inv_create_purchase(%s, %L::uuid, %s)', pg_temp.o(), v_cmd3,
                      pg_temp.j(pg_temp.pdoc(jsonb_build_array(pg_temp.roll(v_mw, v_mb, array[100], 100))))));
  perform pg_temp.ok('I', 'retry with the same command after fixing the payload succeeds (no command row was kept)',
    v_r1 ->> 'status' = 'draft' and not (v_r1 ? 'replayed'));

  -- ضياع الرد بعد ترحيل ناجح
  v_id := (pg_temp.create_purchase(pg_temp.pdoc(jsonb_build_array(pg_temp.roll(v_mw, v_mb, array[300, 200], 2000))))) ->> 'docId';
  v_r1 := pg_temp.rpc(pg_catalog.format('public.zell_inv_post_purchase(%s, %L::uuid, %s, 1)', pg_temp.o(), v_cmd4, v_id));
  select count(*) into v_lots from public.stock_lots;
  v_r2 := pg_temp.rpc(pg_catalog.format('public.zell_inv_post_purchase(%s, %L::uuid, %s, 1)', pg_temp.o(), v_cmd4, v_id));
  perform pg_temp.ok('I', 'lost response: same command + old version → replay with same lots, no duplicates',
    (v_r2 ->> 'replayed')::boolean and (v_r2 - 'replayed') = v_r1 and (select count(*) from public.stock_lots) = v_lots);
  perform pg_temp.ok('I', 'lost response: new command + old version → 45202', pg_temp.epost(v_id, 1) = '45202');
exception when others then
  perform pg_temp.ok('I', 'group crashed', false, sqlstate || ' ' || sqlerrm);
end
$pt_i$;


-- ═══ J. التزامن (محاكاة متتالية) والاعتماديات ═══
do $pt_j$
declare
  v_r jsonb;
  v_id bigint;
  v_l3 bigint;
  v_s3 bigint;
  v_pc bigint := pg_temp.ci('F_PIECE');
  v_mw bigint := pg_temp.ci('F_METER_W');
  v_mb bigint := pg_temp.ci('F_METER_W_BASE');
  v_d2 bigint := pg_temp.ci('D2');
  v_d2v integer := pg_temp.ci('D2_V')::integer;
  v_state text;
begin
  -- تابين
  v_id := (pg_temp.create_purchase(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 100))))) ->> 'docId';
  perform pg_temp.rpc(pg_catalog.format('public.zell_inv_update_purchase(%s, gen_random_uuid(), %s, 1, %s)', pg_temp.o(), v_id,
                      pg_temp.j(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 2, 200))))));
  perform pg_temp.expect('J', 'tab B updates with stale version → 45202',
    pg_catalog.format('public.zell_inv_update_purchase(%s, gen_random_uuid(), %s, 1, %s)', pg_temp.o(), v_id,
                      pg_temp.j(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 3, 300))))), array['45202']);
  perform pg_temp.post_purchase(v_id, 2);
  perform pg_temp.expect('J', 'tab B discards with stale version after tab A posted → 45202',
    pg_catalog.format('public.zell_inv_discard_purchase(%s, gen_random_uuid(), %s, 2, null)', pg_temp.o(), v_id), array['45202']);

  -- إيقاف الموقع / المورد بين الحفظ والترحيل
  v_r := pg_temp.rpc(pg_catalog.format('public.zell_inv_create_location(%s, gen_random_uuid(), %L, %L)', pg_temp.o(), 'PTL3', 'مخزن 3'));
  v_l3 := (v_r ->> 'locationId')::bigint;
  v_id := (pg_temp.create_purchase(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 100)), p_location => v_l3))) ->> 'docId';
  perform pg_temp.rpc(pg_catalog.format('public.zell_inv_update_location(%s, gen_random_uuid(), %s, 1, %L, false)', pg_temp.o(), v_l3, 'مخزن 3'));
  perform pg_temp.ok('J', 'location deactivated after save → 45205 at post', pg_temp.epost(v_id, 1) = '45205');
  v_r := pg_temp.rpc(pg_catalog.format('public.zell_inv_create_supplier(%s, gen_random_uuid(), %L, null, null)', pg_temp.o(), 'مورد 3 ptest'));
  v_s3 := (v_r ->> 'supplierId')::bigint;
  v_id := (pg_temp.create_purchase(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 100)), p_supplier => v_s3))) ->> 'docId';
  perform pg_temp.rpc(pg_catalog.format('public.zell_inv_update_supplier(%s, gen_random_uuid(), %s, 1, %L, null, null, false)', pg_temp.o(), v_s3, 'مورد 3 ptest'));
  perform pg_temp.ok('J', 'supplier deactivated after save → 45204 at post', pg_temp.epost(v_id, 1) = '45204');

  -- الترحيل بيعيد التحقق فعلًا: draft_payload اتعدّل مباشرة بعرض مش مسموح
  v_id := (pg_temp.create_purchase(pg_temp.pdoc(jsonb_build_array(pg_temp.roll(v_mw, v_mb, array[100], 100))))) ->> 'docId';
  update public.purchase_docs d
     set draft_payload = jsonb_set(d.draft_payload, '{lines,0,widthCm}', to_jsonb(pg_temp.ci('F_BAD_WIDTH')))
   where d.id = v_id;
  perform pg_temp.ok('J', 'post re-validates widths (payload tampered after save) → 45207', pg_temp.epost(v_id, 1) = '45207');
  if pg_temp.c('F_INACTIVE_WIDTH_P') is not null then
    v_id := (pg_temp.create_purchase(pg_temp.pdoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 100))))) ->> 'docId';
    update public.purchase_docs d
       set draft_payload = jsonb_set(d.draft_payload, '{lines,0}',
             pg_temp.roll(pg_temp.ci('F_INACTIVE_WIDTH_P'), pg_temp.ci('F_INACTIVE_WIDTH_W'), array[100], 100))
     where d.id = v_id;
    perform pg_temp.ok('J', 'post rejects a real inactive width → 45207', pg_temp.epost(v_id, 1) = '45207');
  else
    perform pg_temp.mark('J', 'post rejects a real inactive width → 45207', 'SKIP', 'no inactive product_widths row exists');
  end if;
  perform pg_temp.mark('J', 'concurrent width deactivation between save and post', 'SKIP',
                       'closed by FOR SHARE vs FOR UPDATE design (§2.6); real parallel test needs an isolated environment');

  -- void مع lot اتلغى يدويًا (بتعطيل الـtrigger كمالك — بيوضح إن الـtriggers مش حاجز ضد المالك) — بيرجع
  begin
    alter table public.stock_lots disable trigger zinv_lot_update_guard;
    update public.stock_lots s set status = 'voided', voided_at = now(), voided_by = pg_temp.c('OWNER')::uuid
     where s.id = (select min(s2.id) from public.stock_lots s2 join public.purchase_doc_lines x on x.id = s2.purchase_line_id
                    where x.doc_id = v_d2);
    alter table public.stock_lots enable trigger zinv_lot_update_guard;
    v_state := pg_temp.try_sql(pg_catalog.format('select public.zell_inv_void_purchase(%s, gen_random_uuid(), %s, %s, %L)',
                               pg_temp.o(), v_d2, v_d2v, 'سبب كافي'), 'service_role');
    raise exception using errcode = 'ZPT01';
  exception when others then
    perform pg_temp.ok('J', 'void with a lot already voided out-of-band → 45213', sqlstate = 'ZPT01' and v_state = '45213',
                       coalesce(v_state, sqlstate || ' ' || sqlerrm));
  end;

  -- مرجع FK مش معروف على stock_lots — بيرجع
  v_state := null;
  begin
    create table public.zz_ptest_lot_ref (lot_id bigint references public.stock_lots (id));
    v_state := pg_temp.try_sql(pg_catalog.format('select public.zell_inv_void_purchase(%s, gen_random_uuid(), %s, %s, %L)',
                               pg_temp.o(), v_d2, v_d2v, 'سبب كافي'), 'service_role');
    raise exception using errcode = 'ZPT01';
  exception when others then
    perform pg_temp.ok('J', 'void blocked by an unknown FK reference to stock_lots → 45213', sqlstate = 'ZPT01' and v_state = '45213',
                       coalesce(v_state, sqlstate || ' ' || sqlerrm));
  end;
exception when others then
  perform pg_temp.ok('J', 'group crashed', false, sqlstate || ' ' || sqlerrm);
end
$pt_j$;


-- ═══ K. رصيد أول المدة ═══
do $pt_k$
declare
  v_r jsonb;
  v_id bigint;
  v_pc bigint := pg_temp.ci('F_PIECE');
  v_mw bigint := pg_temp.ci('F_METER_W');
  v_mb bigint := pg_temp.ci('F_METER_W_BASE');
  v_est jsonb;
begin
  v_r := pg_temp.create_opening(pg_temp.odoc(jsonb_build_array(
    pg_temp.oroll(v_mw, v_mb, array[2750], 380000, true, 'آخر سعر شراء'),
    pg_temp.obatch(v_pc, 12, 60000, false, null),
    pg_temp.obatch(v_pc, 5, 0, false, null, 'عينات مجانية من المصنع'))));
  v_id := (v_r ->> 'docId')::bigint;
  perform pg_temp.ok('K', 'opening draft: OPN- number, totals 440000 / estimated 380000',
    v_r ->> 'docNo' ~ '^OPN-[0-9]{6,}$' and (v_r -> 'totals' ->> 'itemsTotalPiastres')::bigint = 440000
    and (v_r -> 'totals' ->> 'estimatedTotalPiastres')::bigint = 380000);
  v_r := pg_temp.post_opening(v_id, 1);
  select jsonb_agg(s.cost_is_estimated order by x.line_no, s.lot_sequence) into v_est
    from public.stock_lots s join public.opening_stock_lines x on x.id = s.opening_line_id where x.doc_id = v_id;
  perform pg_temp.ok('K', 'opening post: 3 lots, cost_is_estimated copied per line, no allocation',
    v_est = '[true, false, false]'::jsonb and (v_r ->> 'status') = 'posted'
    and not exists (select 1 from public.stock_lots s join public.opening_stock_lines x on x.id = s.opening_line_id
                     where x.doc_id = v_id and (s.allocated_extras_piastres <> 0 or s.allocated_discount_piastres <> 0)));
  perform pg_temp.set_ctx('K1', v_id::text);
  perform pg_temp.ok('K', 'estimated without note → 45203',
    pg_temp.ecreate_opening(pg_temp.odoc(jsonb_build_array(pg_temp.obatch(v_pc, 1, 100, true, null)))) = '45203');
  perform pg_temp.ok('K', 'note without estimate → 45203',
    pg_temp.ecreate_opening(pg_temp.odoc(jsonb_build_array(pg_temp.obatch(v_pc, 1, 100, false, 'تقدير')))) = '45203');
  perform pg_temp.ok('K', 'zero cost marked estimated → 45215',
    pg_temp.ecreate_opening(pg_temp.odoc(jsonb_build_array(pg_temp.obatch(v_pc, 1, 0, true, 'تقدير', 'مجاني')))) = '45215');
  perform pg_temp.ok('K', 'reason with positive cost → 45215',
    pg_temp.ecreate_opening(pg_temp.odoc(jsonb_build_array(pg_temp.obatch(v_pc, 1, 10, false, null, 'مجاني')))) = '45215');
  perform pg_temp.ok('K', 'charges key on opening → 45203',
    pg_temp.ecreate_opening(pg_temp.odoc(jsonb_build_array(pg_temp.obatch(v_pc, 1, 10, false, null))) || '{"charges": []}') = '45203');
  perform pg_temp.ok('K', 'supplierId key on opening → 45203',
    pg_temp.ecreate_opening(pg_temp.odoc(jsonb_build_array(pg_temp.obatch(v_pc, 1, 10, false, null))) || '{"supplierId": 1}') = '45203');
  perform pg_temp.ok('K', 'costIsEstimated missing → 45203',
    pg_temp.ecreate_opening(pg_temp.odoc(jsonb_build_array(pg_temp.batch(v_pc, 1, 10)))) = '45203');
  v_r := pg_temp.create_opening(pg_temp.odoc(jsonb_build_array(pg_temp.obatch(v_pc, 1, 10, false, null))));
  v_r := pg_temp.rpc(pg_catalog.format('public.zell_inv_discard_opening(%s, gen_random_uuid(), %s, 1, null)', pg_temp.o(), v_r ->> 'docId'));
  perform pg_temp.ok('K', 'discard opening draft', v_r ->> 'status' = 'discarded');
  v_r := pg_temp.create_opening(pg_temp.odoc(jsonb_build_array(pg_temp.obatch(v_pc, 2, 20, false, null))));
  v_r := pg_temp.post_opening((v_r ->> 'docId')::bigint, 1);
  v_r := pg_temp.rpc(pg_catalog.format('public.zell_inv_void_opening(%s, gen_random_uuid(), %s, 2, %L)', pg_temp.o(), v_r ->> 'docId', 'جرد غلط'));
  perform pg_temp.ok('K', 'void posted opening → voided, lots voided', v_r ->> 'status' = 'voided' and (v_r ->> 'voidedLots')::integer = 1);
  v_r := pg_temp.rpc(pg_catalog.format('public.zell_inv_get_opening(%s, %s)', pg_temp.o(), pg_temp.ci('K1')));
  perform pg_temp.ok('K', 'get_opening returns lines and lots', jsonb_array_length(v_r -> 'lines') = 3 and jsonb_array_length(v_r -> 'lots') = 3);
  v_r := pg_temp.rpc(pg_catalog.format('public.zell_inv_preview_opening(%s, %s)', pg_temp.o(),
                     pg_temp.j(pg_temp.odoc(jsonb_build_array(pg_temp.oroll(v_mw, v_mb, array[2000, 1000], 1000, false, null))))));
  perform pg_temp.ok('K', 'preview_opening splits by length (667 + 333)',
    (v_r -> 'lots' -> 0 ->> 'baseCostPiastres')::bigint = 667 and (v_r -> 'lots' -> 1 ->> 'baseCostPiastres')::bigint = 333);
exception when others then
  perform pg_temp.ok('K', 'group crashed', false, sqlstate || ' ' || sqlerrm);
end
$pt_k$;


-- ═══ F. الثبات (DML مباشر كـ postgres) ═══
do $pt_f$
declare
  v_t text;
  v_d2 bigint := pg_temp.ci('D2');
  v_draft bigint;
  v_lot bigint;
  v_state text;
  v_pc bigint := pg_temp.ci('F_PIECE');
begin
  select min(d.id) into v_draft from public.purchase_docs d where d.status = 'draft';
  select min(s.id) into v_lot from public.stock_lots s join public.purchase_doc_lines x on x.id = s.purchase_line_id where x.doc_id = v_d2;
  perform pg_temp.expect_sql('F', 'update total_cost on a posted doc → 45216',
    pg_catalog.format('update public.purchase_docs set total_cost_piastres = total_cost_piastres + 1 where id = %s', v_d2), null, array['45216']);
  perform pg_temp.expect_sql('F', 'change doc_no on a draft → 45216',
    pg_catalog.format('update public.purchase_docs set doc_no = %L where id = %s', 'PUR-999999', v_draft), null, array['45216']);
  perform pg_temp.expect_sql('F', 'change created_by on a draft → 45216',
    pg_catalog.format('update public.purchase_docs set created_by = gen_random_uuid() where id = %s', v_draft), null, array['45216']);
  perform pg_temp.expect_sql('F', 'set posted_at on a draft (column outside set A) → 45216',
    pg_catalog.format('update public.purchase_docs set posted_at = now() where id = %s', v_draft), null, array['45216']);
  perform pg_temp.expect_sql('F', 'posted → draft transition → 45216',
    pg_catalog.format('update public.purchase_docs set status = %L where id = %s', 'draft', v_d2), null, array['45216']);
  foreach v_t in array array['inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log'] loop
    perform pg_temp.ok('F', 'table has rows for the DELETE test: ' || v_t,
      pg_temp.try_sql(pg_catalog.format('do $x$ begin if not exists (select 1 from public.%I) then raise exception using errcode = %L; end if; end $x$', v_t, 'ZPT02'), null) = 'OK');
    perform pg_temp.expect_sql('F', 'DELETE blocked: ' || v_t,
      pg_catalog.format('delete from public.%I where ctid = (select ctid from public.%I limit 1)', v_t, v_t), null, array['45216']);
  end loop;
  perform pg_temp.expect_sql('F', 'update a lot cost → 45216',
    pg_catalog.format('update public.stock_lots set base_cost_piastres = base_cost_piastres + 1 where id = %s', v_lot), null, array['45216']);
  perform pg_temp.expect_sql('F', 'void a lot while its document is posted → 45216',
    pg_catalog.format('update public.stock_lots set status = %L, voided_at = now(), voided_by = gen_random_uuid() where id = %s', 'voided', v_lot),
    null, array['45216']);
  perform pg_temp.expect_sql('F', 'insert a line into a posted document → 45216',
    pg_catalog.format('insert into public.purchase_doc_lines (doc_id, line_no, line_kind, product_id, product_name_snapshot, sale_unit_snapshot, quantity, line_total_piastres, allocated_extras_piastres, allocated_discount_piastres, landed_total_piastres) values (%s, 99, %L, %s, %L, %L, 1, 1, 0, 0, 1)',
                      v_d2, 'batch', v_pc, 'x', 'piece'), null, array['45216']);
  perform pg_temp.expect_sql('F', 'update a line → 45216',
    'update public.purchase_doc_lines set line_total_piastres = line_total_piastres where ctid = (select ctid from public.purchase_doc_lines limit 1)', null, array['45216']);
  perform pg_temp.expect_sql('F', 'update a command → 45216',
    'update public.inventory_commands set result = result where ctid = (select ctid from public.inventory_commands limit 1)', null, array['45216']);
  perform pg_temp.expect_sql('F', 'update an audit row → 45216',
    'update public.inventory_audit_log set "after" = "after" where ctid = (select ctid from public.inventory_audit_log limit 1)', null, array['45216']);
  perform pg_temp.expect_sql('F', 'change MAIN code → 45216', 'update public.inventory_locations set code = ''MAIN2'' where code = ''MAIN''', null, array['45216']);
  perform pg_temp.expect_sql('F', 'deactivate MAIN directly → 45220', 'update public.inventory_locations set is_active = false where code = ''MAIN''', null, array['45220']);
  perform pg_temp.expect_sql('F', 'set is_default on another location → 45220',
    pg_catalog.format('update public.inventory_locations set is_default = true where id = %s', pg_temp.ci('L2')), null, array['45220']);
  perform pg_temp.expect_sql('F', 'change supplier created_by → 45216',
    'update public.suppliers set created_by = gen_random_uuid() where ctid = (select ctid from public.suppliers limit 1)', null, array['45216']);

  -- TRUNCATE: الـcatalog + جداول مفيش FK جاي عليها + الباقي (FK ممكن يرفض قبل الـtrigger)
  perform pg_temp.ok('F', 'every 0020 table has an enabled BEFORE TRUNCATE FOR EACH STATEMENT trigger',
    (select count(*) from pg_catalog.pg_trigger g join pg_catalog.pg_proc f on f.oid = g.tgfoid
      where g.tgname = 'zinv_no_truncate' and f.proname = 'zell_inv_trg_no_truncate' and g.tgtype = 34 and g.tgenabled = 'O'
        and g.tgrelid = any (array(select ('public.' || t)::regclass::oid from unnest(array['inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log']) t))) = 10);
  perform pg_temp.ok('F', 'only 0020 tables reference 0020 tables (pre-check before TRUNCATE CASCADE)',
    not exists (select 1 from pg_catalog.pg_constraint c
                 where c.contype = 'f'
                   and c.confrelid = any (array(select ('public.' || t)::regclass::oid from unnest(array['inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log']) t))
                   and not (c.conrelid = any (array(select ('public.' || t)::regclass::oid from unnest(array['inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log']) t)))));
  foreach v_t in array array['stock_lots', 'purchase_doc_charges', 'inventory_audit_log'] loop
    perform pg_temp.expect_sql('F', 'TRUNCATE leaf table blocked by trigger: ' || v_t, 'truncate public.' || v_t, null, array['45216']);
  end loop;
  foreach v_t in array array['inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'opening_stock_docs',
                             'opening_stock_lines', 'inventory_commands'] loop
    v_state := pg_temp.try_sql('truncate public.' || v_t, null);
    perform pg_temp.ok('F', 'TRUNCATE (no cascade) does not succeed: ' || v_t, v_state in ('0A000', '45216'), v_state);
    perform pg_temp.expect_sql('F', 'TRUNCATE CASCADE blocked by trigger: ' || v_t, 'truncate public.' || v_t || ' cascade', null, array['45216']);
  end loop;
exception when others then
  perform pg_temp.ok('F', 'group crashed', false, sqlstate || ' ' || sqlerrm);
end
$pt_f$;


-- ═══ H. حماية products.sale_unit (من غير لمس products) ═══
create temporary table zell_pt_probe (id integer, sale_unit text) on commit drop;
create trigger zinv_probe_sale_unit
  before update of sale_unit on pg_temp.zell_pt_probe
  for each row when (old.sale_unit is distinct from new.sale_unit)
  execute function public.zell_inv_trg_products_sale_unit();

do $pt_h$
begin
  insert into pg_temp.zell_pt_probe values (pg_temp.ci('F_PIECE')::integer, 'piece'), (pg_temp.ci('F_METER_2')::integer, 'meter');
  perform pg_temp.ok('H', 'has_stock_refs true for a product with posted lots',
                     public.zell_inv_product_has_stock_refs(pg_temp.ci('F_PIECE')::integer));
  perform pg_temp.ok('H', 'has_stock_refs false for a product never used in a posted document',
                     not public.zell_inv_product_has_stock_refs(pg_temp.ci('F_METER_2')::integer));
  perform pg_temp.expect_sql('H', 'probe: changing sale_unit of a product with refs → 45217',
    pg_catalog.format('update pg_temp.zell_pt_probe set sale_unit = %L where id = %s', 'meter', pg_temp.ci('F_PIECE')), null, array['45217']);
  perform pg_temp.expect_sql('H', 'probe: changing sale_unit of a product without refs is allowed',
    pg_catalog.format('update pg_temp.zell_pt_probe set sale_unit = %L where id = %s', 'piece', pg_temp.ci('F_METER_2')), null, array['OK']);
  perform pg_temp.ok('H', 'real products trigger: BEFORE UPDATE OF sale_unit with IS DISTINCT FROM guard',
    (select pg_catalog.pg_get_triggerdef(g.oid) from pg_catalog.pg_trigger g
      where g.tgrelid = 'public.products'::regclass and g.tgname = 'zinv_products_sale_unit')
    ~* 'BEFORE UPDATE OF sale_unit ON (public\.)?products FOR EACH ROW WHEN .*old\.sale_unit IS DISTINCT FROM new\.sale_unit');
exception when others then
  perform pg_temp.ok('H', 'group crashed', false, sqlstate || ' ' || sqlerrm);
end
$pt_h$;


-- ═══ L. الـaudit ═══
do $pt_l$
begin
  perform pg_temp.ok('L', 'every command has exactly one audit row with the same action, and vice versa',
    (select count(*) from public.inventory_commands) = (select count(*) from public.inventory_audit_log)
    and not exists (select 1 from public.inventory_commands c
                     where (select count(*) from public.inventory_audit_log a
                             where a.command_id = c.command_id and a.action = c.command_kind) <> 1));
  perform pg_temp.ok('L', 'create audit rows have no before, others have before',
    not exists (select 1 from public.inventory_audit_log a
                 where (a.action like '%.create') <> (a."before" is null)));
exception when others then
  perform pg_temp.ok('L', 'group crashed', false, sqlstate || ' ' || sqlerrm);
end
$pt_l$;


-- ═══ M. الأداء: وجود الفهارس، قابلية الاستخدام (enable_seqscan=off)، الخطة الطبيعية (معلومة)، والـbenchmark ═══
do $pt_m$
declare
  r record;
  v_plan text;
  v_id bigint;
  v_t0 timestamptz;
  v_ms numeric;
  v_mw bigint := pg_temp.ci('F_METER_W');
  v_mb bigint := pg_temp.ci('F_METER_W_BASE');
  v_i integer;
  v_d bigint;
  v_l bigint;
  v_owner uuid := pg_temp.c('OWNER')::uuid;
begin
  if pg_catalog.current_setting('zell.ptest_profile') = 'full' then
    for v_i in 1 .. 2000 loop
      insert into public.purchase_docs (doc_no, status, supplier_id, location_id, doc_date, draft_payload, created_by, updated_by)
      values ('PUR-9' || lpad(v_i::text, 6, '0'), 'draft', case when v_i % 3 = 0 then pg_temp.ci('S1') end,
              pg_temp.ci('MAIN'), (now() at time zone 'Africa/Cairo')::date, '{}'::jsonb, v_owner, v_owner)
      returning id into v_d;
      insert into public.purchase_doc_lines (doc_id, line_no, line_kind, product_id, product_name_snapshot, sale_unit_snapshot,
        width_cm_snapshot, roll_count, total_length_cm, line_total_piastres, allocated_extras_piastres,
        allocated_discount_piastres, landed_total_piastres)
      values (v_d, 1, 'roll', v_mw, 'x', 'meter', v_mb, 10, 1000, 1000, 0, 0, 1000)
      returning id into v_l;
      insert into public.stock_lots (lot_code, source_kind, purchase_line_id, lot_sequence, lot_kind, product_id, location_id,
        width_cm_snapshot, initial_length_cm, base_cost_piastres, landed_cost_piastres, cost_is_estimated, received_on)
      select 'R-9' || lpad((v_i * 10 + g)::text, 8, '0'), 'purchase', v_l, g, 'roll', v_mw, pg_temp.ci('MAIN'),
             v_mb, 100, 100, 100, false, (now() at time zone 'Africa/Cairo')::date
        from generate_series(1, 10) g;
      update public.purchase_docs d
         set status = 'posted', draft_payload = null, items_subtotal_piastres = 1000, total_cost_piastres = 1000,
             line_count = 1, lot_count = 10, location_name_snapshot = 'x',
             supplier_name_snapshot = case when d.supplier_id is not null then 'x' end,
             posted_at = now(), posted_by = v_owner, version = 2
       where d.id = v_d;
    end loop;
    perform pg_temp.mark('M', 'full profile: representative data generated', 'INFO', '2000 docs / 20000 lots');
  end if;
  analyze public.purchase_docs;
  analyze public.purchase_doc_lines;
  analyze public.opening_stock_docs;
  analyze public.opening_stock_lines;
  analyze public.stock_lots;
  analyze public.suppliers;
  analyze public.inventory_locations;

  for r in select * from (values
      ('locations.active', 'inventory_locations_active_id', 'select l.id from public.inventory_locations l where l.is_active and l.id > 0 order by l.id limit 25'),
      ('suppliers.all', 'suppliers_name_key_key', 'select s.name_key from public.suppliers s where s.name_key > '''' order by s.name_key limit 25'),
      ('suppliers.active', 'suppliers_active_name_key', 'select s.name_key from public.suppliers s where s.is_active and s.name_key > '''' order by s.name_key limit 25'),
      ('purchases.status', 'purchase_docs_status_id', 'select d.id from public.purchase_docs d where d.status = ''posted'' and d.id < 9223372036854775807 order by d.id desc limit 25'),
      ('purchases.supplier', 'purchase_docs_supplier_id', 'select d.id from public.purchase_docs d where d.supplier_id = 1 and d.id < 9223372036854775807 order by d.id desc limit 25'),
      ('purchases.supplier_status', 'purchase_docs_supplier_status_id', 'select d.id from public.purchase_docs d where d.supplier_id = 1 and d.status = ''posted'' and d.id < 9223372036854775807 order by d.id desc limit 25'),
      ('openings.status', 'opening_stock_docs_status_id', 'select d.id from public.opening_stock_docs d where d.status = ''posted'' and d.id < 9223372036854775807 order by d.id desc limit 25'),
      ('lots.status', 'stock_lots_status_id', 'select s.id from public.stock_lots s where s.status = ''active'' and s.id < 9223372036854775807 order by s.id desc limit 25'),
      ('lots.product', 'stock_lots_product_status_id', 'select s.id from public.stock_lots s where s.product_id = 1 and s.status = ''active'' and s.id < 9223372036854775807 order by s.id desc limit 25'),
      ('lots.location', 'stock_lots_location_status_id', 'select s.id from public.stock_lots s where s.location_id = 1 and s.status = ''active'' and s.id < 9223372036854775807 order by s.id desc limit 25'),
      ('lots.product_location', 'stock_lots_product_location_status_id', 'select s.id from public.stock_lots s where s.product_id = 1 and s.location_id = 1 and s.status = ''active'' and s.id < 9223372036854775807 order by s.id desc limit 25'),
      ('guard.purchase_lines', 'purchase_doc_lines_product', 'select 1 from public.purchase_doc_lines l where l.product_id = 1 limit 1'),
      ('guard.opening_lines', 'opening_stock_lines_product', 'select 1 from public.opening_stock_lines o where o.product_id = 1 limit 1'),
      ('guard.lots', 'stock_lots_product_(status|location_status)_id', 'select 1 from public.stock_lots s where s.product_id = 1 limit 1')
    ) as b(label, idx, q)
  loop
    perform pg_catalog.set_config('enable_seqscan', 'off', true);
    execute 'explain (format json) ' || r.q into v_plan;
    perform pg_catalog.set_config('enable_seqscan', 'on', true);
    perform pg_temp.ok('M', 'index usable for branch ' || r.label, v_plan ~ ('"Index Name": "' || r.idx || '"'),
                       case when v_plan ~ ('"Index Name": "' || r.idx || '"') then null else left(v_plan, 300) end);
    execute 'explain (format json) ' || r.q into v_plan;
    perform pg_temp.mark('M', 'natural plan ' || r.label, 'INFO',
                         coalesce(substring(v_plan from '"Node Type": "([^"]+)"'), '?') || ' / ' ||
                         coalesce(substring(v_plan from '"Index Name": "([^"]+)"'), 'no index'));
  end loop;

  -- benchmark: ترحيل مستند فيه 200 lot (رول واحد × 200)
  v_id := (pg_temp.create_purchase(pg_temp.pdoc(
            jsonb_build_array(pg_temp.roll(v_mw, v_mb, array(select 100 from generate_series(1, 200)), 2000000)),
            jsonb_build_array(pg_temp.charge('transport', 777))))) ->> 'docId';
  v_t0 := clock_timestamp();
  perform pg_temp.post_purchase(v_id, 1);
  v_ms := round(extract(epoch from clock_timestamp() - v_t0) * 1000);
  if v_ms < 2000 then
    perform pg_temp.mark('M', 'benchmark post 200 lots', 'PASS', v_ms || ' ms');
  elsif v_ms <= 5000 then
    perform pg_temp.mark('M', 'benchmark post 200 lots', 'NOTE', v_ms || ' ms (2–5 s: check load)');
  else
    perform pg_temp.mark('M', 'benchmark post 200 lots', 'REVIEW', v_ms || ' ms (> 5 s: REVIEW_REQUIRED — check pg_stat_activity and plans)');
  end if;
  perform pg_temp.ok('M', 'benchmark doc has 200 lots and landed sum = total',
    (select count(*) from public.stock_lots s join public.purchase_doc_lines x on x.id = s.purchase_line_id where x.doc_id = v_id) = 200
    and (select sum(s.landed_cost_piastres) from public.stock_lots s join public.purchase_doc_lines x on x.id = s.purchase_line_id where x.doc_id = v_id)
        = (select d.total_cost_piastres from public.purchase_docs d where d.id = v_id));
exception when others then
  perform pg_temp.ok('M', 'group crashed', false, sqlstate || ' ' || sqlerrm);
end
$pt_m$;


-- ═══ N. الختام: الـrollback بيرفض مع وجود بيانات، والبصمة الحية ماتغيرتش ═══
do $pt_n$
begin
  begin
    if pg_catalog.to_regrole('zell_inventory_definer') is null
     or (select count(*) from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname like 'zell\_inv\_%') <> 43
     or (select count(*) from pg_catalog.pg_class c
          where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
            and c.relname in ('inventory_locations', 'suppliers', 'purchase_docs', 'purchase_doc_lines', 'purchase_doc_charges', 'opening_stock_docs', 'opening_stock_lines', 'stock_lots', 'inventory_commands', 'inventory_audit_log')) <> 10 then
    raise exception 'ZELL_0020_ROLLBACK_NOT_FULLY_APPLIED';
  end if;
  if exists (select 1 from public.suppliers) or exists (select 1 from public.purchase_docs)
     or exists (select 1 from public.purchase_doc_lines) or exists (select 1 from public.purchase_doc_charges)
     or exists (select 1 from public.opening_stock_docs) or exists (select 1 from public.opening_stock_lines)
     or exists (select 1 from public.stock_lots) or exists (select 1 from public.inventory_commands)
     or exists (select 1 from public.inventory_audit_log)
     or (select count(*) from public.inventory_locations) <> 1
     or not exists (select 1 from public.inventory_locations l where l.code = 'MAIN' and l.is_default and l.is_active) then
    raise exception 'ZELL_0020_ROLLBACK_HAS_DATA';
  end if;
    raise exception using errcode = 'ZPT01';
  exception when others then
    perform pg_temp.ok('N', 'rollback pre-check refuses when data exists', sqlerrm = 'ZELL_0020_ROLLBACK_HAS_DATA', sqlerrm);
  end;
  perform pg_temp.ok('N', 'live fingerprint unchanged (orders, items, products, widths, addons, coupons, settings, admins, functions)',
    (select row(b.*)::text from pg_temp.zell_0020_pt_fp_before b)
    = (select row(n.*)::text from (select
  (select count(*) from public.orders) as orders_n,
  (select count(*) from public.order_items) as order_items_n,
  (select count(*) from public.products) as products_n,
  (select count(*) from public.product_widths) as product_widths_n,
  (select count(*) from public.product_addons) as product_addons_n,
  (select count(*) from public.coupons) as coupons_n,
  (select count(*) from public.settings) as settings_n,
  (select count(*) from public.admin_users) as admin_users_n,
  (select coalesce(sum(o.total_piastres), 0) from public.orders o) as orders_total,
  (select md5(coalesce(string_agg(p.id || ':' || p.sale_unit || ':' || p.price_per_meter_piastres || ':' || p.width_cm, ',' order by p.id), ''))
     from public.products p) as products_md5,
  (select md5(coalesce(string_agg(s.key || '=' || s.value::text, ',' order by s.key), ''))
     from public.settings s) as settings_md5,
  (select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' order by p.oid::regprocedure::text), ''))
     from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('zell_create_order', 'zell_get_order_receipt', 'zell_preview_coupon',
                        'zell_set_product_widths', 'zell_set_product_addons', 'zell_orders_cancelled_final')) as functions_md5) n));
exception when others then
  perform pg_temp.ok('N', 'group crashed', false, sqlstate || ' ' || sqlerrm);
end
$pt_n$;

do $pt_end$
declare
  v_pass integer;
  v_fail integer;
  v_skip integer;
  v_review integer;
  v_fails text;
  v_skips text;
  v_notes text;
begin
  select count(*) filter (where status = 'PASS'), count(*) filter (where status = 'FAIL'),
         count(*) filter (where status = 'SKIP'), count(*) filter (where status = 'REVIEW')
    into v_pass, v_fail, v_skip, v_review
    from pg_temp.zell_pt_log;
  select string_agg(grp || ':' || label || coalesce(' [' || info || ']', ''), ' | ' order by n) into v_fails
    from pg_temp.zell_pt_log where status = 'FAIL';
  select string_agg(grp || ':' || label || coalesce(' [' || info || ']', ''), ' | ' order by n) into v_skips
    from pg_temp.zell_pt_log where status = 'SKIP';
  select string_agg(grp || ':' || label || coalesce(' [' || info || ']', ''), ' | ' order by n) into v_notes
    from pg_temp.zell_pt_log where status in ('REVIEW', 'NOTE') or (status = 'PASS' and label like 'benchmark%');
  raise exception 'ZELL_0020_PTEST_RESULT profile=% pass=% fail=% skip=% review=% || FAIL: % || SKIP: % || NOTES: %',
    pg_catalog.current_setting('zell.ptest_profile'), v_pass, v_fail, v_skip, v_review,
    coalesce(v_fails, '-'), coalesce(v_skips, '-'), coalesce(v_notes, '-');
end
$pt_end$;

rollback;
