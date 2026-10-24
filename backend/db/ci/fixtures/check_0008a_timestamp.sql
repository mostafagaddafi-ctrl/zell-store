-- backend/db/ci/fixtures/check_0008a_timestamp.sql — CI ONLY (contract §9-4). Read only.
-- Pass = after 0008a, settings.announcement.updated_at equals max(updated_at) of the six content keys exactly
--        (2026-01-01 00:00:06.123456+00 from before_0008a_content.sql), and the six keys are untouched.
do $t$
declare
  v_six timestamptz;
  v_ann timestamptz;
  v_n   integer;
begin
  select pg_catalog.max(updated_at), pg_catalog.count(*) into v_six, v_n
  from public.settings where key in ('hero','order_steps','faqs','sections','footer_links','trust_line');
  select updated_at into v_ann from public.settings where key = 'announcement';
  if v_n <> 6 then raise exception 'ZELL_0008A_TS_SIX_COUNT: %', v_n; end if;
  if v_six is distinct from timestamptz '2026-01-01 00:00:06.123456+00' then raise exception 'ZELL_0008A_TS_FIXTURE_CHANGED: %', v_six; end if;
  if v_ann is distinct from v_six then raise exception 'ZELL_0008A_TS_NOT_NORMALIZED: announcement=% six=%', v_ann, v_six; end if;
  raise notice 'ZELL_0008A_TS_OK announcement=%', v_ann;
end
$t$;
