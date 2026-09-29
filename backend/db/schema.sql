-- =====================================================================
-- متجر أفلام الحماية DIY — سكربت تهيئة قاعدة البيانات (PostgreSQL / Supabase)
-- محمول بالكامل: نفّذه في Supabase SQL Editor أو أي بيئة Postgres.
-- قاعدة ثابتة: كل الأرقام integer — الفلوس بالقرش، الأطوال بالسنتيمتر.
-- =====================================================================

-- ------------------------- المنتجات -------------------------
create table if not exists products (
  id                        serial primary key,
  name_ar                   text    not null,
  name_en                   text,
  description_ar            text,
  image_url                 text,
  price_per_meter_piastres  integer not null check (price_per_meter_piastres > 0),
  width_cm                  integer not null default 50  check (width_cm > 0),
  min_length_cm             integer not null default 300 check (min_length_cm > 0),
  step_cm                   integer not null default 50  check (step_cm > 0),
  max_length_cm             integer not null default 3000 check (max_length_cm > 0),
  is_active                 boolean not null default true,
  sort_order                integer not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists products_active_idx on products (is_active, sort_order);

-- ------------------------- الطلبات (رأس الطلب) -------------------------
create table if not exists orders (
  id                      serial primary key,
  order_number            text    not null unique,
  status                  text    not null default 'new'
                            check (status in ('new','confirmed','shipped','delivered','cancelled')),
  customer_name           text    not null,
  customer_phone          text    not null,
  governorate             text    not null,
  address                 text    not null,
  notes                   text,
  subtotal_piastres       integer not null check (subtotal_piastres >= 0),
  shipping_piastres       integer not null default 0 check (shipping_piastres >= 0),
  total_piastres          integer not null check (total_piastres >= 0),
  notified_at             timestamptz,
  notify_error            text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists orders_status_idx     on orders (status);
create index if not exists orders_created_at_idx on orders (created_at desc);
create index if not exists orders_phone_idx      on orders (customer_phone);

-- ------------------- أصناف الطلب (لقطة مجمّدة وقت الشراء) -------------------
create table if not exists order_items (
  id                    serial primary key,
  order_id              integer not null references orders (id) on delete cascade,
  product_id            integer references products (id),
  product_name_ar       text    not null,
  product_image_url     text,
  unit_price_piastres   integer not null check (unit_price_piastres > 0),
  length_cm             integer not null check (length_cm > 0),
  width_cm              integer not null check (width_cm > 0),
  line_total_piastres   integer not null check (line_total_piastres >= 0),
  created_at            timestamptz not null default now()
);

create index if not exists order_items_order_idx on order_items (order_id);

-- ------------------------- الإعدادات -------------------------
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ------------------------- بيانات مبدئية -------------------------
insert into products (name_ar, name_en, description_ar, image_url, price_per_meter_piastres, width_cm, min_length_cm, step_cm, sort_order)
select * from (values
  ('فيلم عازل حراري للشبابيك', 'Heat Rejection Window Film',
   'يقلل حرارة الشمس والوهج في الصالة والشبابيك، ويوفّر في التكييف.',
   null::text, 18000, 50, 300, 50, 1),
  ('فيلم مطفي للخصوصية', 'Frosted Privacy Film',
   'زجاج مطفي يمنع الرؤية من بره ويدخّل النور — للحمام والمطبخ والأبواب الداخلية.',
   null::text, 12000, 50, 300, 50, 2),
  ('فيلم عاكس (مرايا من بره)', 'One-Way Mirror Film',
   'من بره مراية ومن جوه رؤية عادية بالنهار — خصوصية للبلكونة والشبابيك.',
   null::text, 20000, 50, 300, 50, 3),
  ('فيلم أمان شفاف', 'Safety & Security Film',
   'يمسك الزجاج مكانه لو اتكسر ويقلل خطر الشظايا — أمان للأطفال.',
   null::text, 24000, 50, 300, 50, 4)
) as v
where not exists (select 1 from products);

insert into settings (key, value) values
  ('store_name',            '"ZELL"'::jsonb),
  ('logo_url',              '""'::jsonb),
  ('whatsapp_number',       '"201000000000"'::jsonb),
  ('whatsapp_message',      '"مرحباً ZELL، عايز أستفسر عن فيلم زجاج للبيت"'::jsonb),
  ('offer_text',            '"أدوات التركيب مرفقة مجاناً"'::jsonb),
  ('shipping_default_piastres', '8000'::jsonb),
  ('free_shipping_threshold_piastres', '0'::jsonb),
  ('notify_email',          '""'::jsonb),
  ('telegram_bot_token',    '""'::jsonb),
  ('telegram_chat_id',      '""'::jsonb),
  ('shipping_rates', '{
     "القاهرة": 5000, "الجيزة": 5000, "القليوبية": 6000, "الإسكندرية": 7000,
     "الدقهلية": 7000, "الشرقية": 7000, "المنوفية": 7000, "الغربية": 7000,
     "كفر الشيخ": 8000, "البحيرة": 8000, "دمياط": 8000, "بورسعيد": 8000,
     "الإسماعيلية": 8000, "السويس": 8000, "الفيوم": 8000, "بني سويف": 8000,
     "المنيا": 9000, "أسيوط": 9000, "سوهاج": 9000, "قنا": 10000,
     "الأقصر": 10000, "أسوان": 11000, "البحر الأحمر": 12000, "مطروح": 12000,
     "شمال سيناء": 13000, "جنوب سيناء": 13000, "الوادي الجديد": 13000
   }'::jsonb)
on conflict (key) do nothing;
