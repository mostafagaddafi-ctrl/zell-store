-- =====================================================================
-- backend/db/ci/fixtures/before_0008a_content.sql — CI ONLY (contract §9-4). Synthetic content rows.
-- Why: 0008a sets settings.announcement.updated_at = max(updated_at) of the six content keys; on an empty
--      database there are no such rows and 0008a writes NULL into a NOT NULL column.
-- Keys: the six content keys of 0008 / 0008a and apps/admin/lib/data/reads.ts CONTENT_KEYS (announcement is
--       inserted by 0008). Values: synthetic placeholders shaped like apps/admin/lib/adminData.ts.
-- No Production data · no migration edited · fixed timestamps (max = 2026-01-01 00:00:06.123456+00).
-- Placement: after 0008 and right before 0008a. Success is NOT evidence that a new store bootstraps.
-- =====================================================================
begin;

do $g$
begin
  if coalesce(pg_catalog.current_setting('zell.ci_scratch', true), '') <> 'on' then
    raise exception 'ZELL_FIXTURE_NOT_SCRATCH';
  end if;
  if current_user <> 'postgres' then
    raise exception 'ZELL_FIXTURE_WRONG_ROLE: %', current_user;
  end if;
  if pg_catalog.to_regclass('public.settings') is null then
    raise exception 'ZELL_FIXTURE_NO_SETTINGS';
  end if;
  if not exists (select 1 from public.settings where key = 'announcement') then
    raise exception 'ZELL_FIXTURE_NO_ANNOUNCEMENT: 0008 must run first';
  end if;
  if exists (select 1 from public.settings where key in ('hero','order_steps','faqs','sections','footer_links','trust_line')) then
    raise exception 'ZELL_FIXTURE_KEYS_ALREADY_PRESENT';
  end if;
end
$g$;

insert into public.settings (key, value, updated_at) values
  ('hero', '{"title": "عنوان تجريبي", "accent": "كلمة تجريبية", "subtitle": "وصف تجريبي", "ctaLabel": "زر تجريبي", "productSizeEntry": "cm"}'::jsonb,
   timestamptz '2026-01-01 00:00:01+00'),
  ('order_steps', '[{"title": "خطوة تجريبية", "description": "وصف تجريبي"}]'::jsonb,
   timestamptz '2026-01-01 00:00:02+00'),
  ('faqs', '[{"question": "سؤال تجريبي؟", "answer": "إجابة تجريبية."}]'::jsonb,
   timestamptz '2026-01-01 00:00:03+00'),
  ('sections', '[{"key": "hero", "visible": true, "sortOrder": 0}, {"key": "products", "visible": true, "sortOrder": 1}, {"key": "how_it_works", "visible": true, "sortOrder": 2}, {"key": "faq", "visible": true, "sortOrder": 3}]'::jsonb,
   timestamptz '2026-01-01 00:00:04+00'),
  ('footer_links', '[{"label": "رابط تجريبي", "href": "/"}]'::jsonb,
   timestamptz '2026-01-01 00:00:05+00'),
  ('trust_line', '""'::jsonb,
   timestamptz '2026-01-01 00:00:06.123456+00');

commit;
