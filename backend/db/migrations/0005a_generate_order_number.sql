-- =====================================================================
-- 0005a_generate_order_number.sql
-- الحالة: مسودة — لم تُنفّذ.
--
-- كانت اعتمادية مفقودة في مسودة 0005 القديمة. دلوقتي migration مستقلة.
--
-- الصيغة: FLM-XXXXXX بأبجدية 32 حرف من غير O/0/I/1.
-- العشوائية: pg_catalog.gen_random_uuid() (مدمجة في Postgres 13+ — متاحة في Supabase).
--   بديل أقوى لو pgcrypto مفعّلة: extensions.gen_random_bytes(8) — نقطة مراجعة.
--
-- ⚠ التصادم: الدالة بتحاول تتجنّبه بالفحص، لكن الفحص **مش ضمان** مع التزامن.
--   الضمان الحقيقي = القيد الفريد على orders.order_number + إعادة المحاولة عند
--   unique_violation في 0005c. الاتنين مطلوبين مع بعض.
-- =====================================================================

begin;

create or replace function public.generate_order_number(p_prefix text default 'FLM')
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 حرف، بدون O/0/I/1
  c_len      constant integer := 6;
  c_tries    constant integer := 10;
  v_hex      text;
  v_code     text;
  v_candidate text;
begin
  for i in 1..c_tries loop
    -- 32 حرف hex من UUID عشوائي
    v_hex := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    v_code := '';
    for j in 0..(c_len - 1) loop
      -- كل حرفين hex → رقم 0..255 → حرف من الأبجدية
      v_code := v_code || pg_catalog.substr(
        c_alphabet,
        (('x' || pg_catalog.substr(v_hex, (j * 2) + 1, 2))::bit(8)::integer % 32) + 1,
        1);
    end loop;

    v_candidate := p_prefix || '-' || v_code;

    if not exists (select 1 from public.orders o where o.order_number = v_candidate) then
      return v_candidate;
    end if;
  end loop;

  raise exception 'ZELL_ORDER_NUMBER_EXHAUSTED' using errcode = '45050';
end;
$$;

-- الدالة SECURITY INVOKER عن قصد: بتشتغل بصلاحيات المنادي (zell_definer)،
-- واللي عنده SELECT على orders عن طريق policy محدودة.
revoke all on function public.generate_order_number(text) from public, anon, authenticated;

commit;

-- =====================================================================
-- rollback
-- =====================================================================
-- begin;
--   drop function if exists public.generate_order_number(text);
-- commit;

-- =====================================================================
-- نقاط مراجعة
-- =====================================================================
-- 1) التحويل ('x' || hex)::bit(8)::integer أسلوب قياسي في Postgres لكنه غير بديهي —
--    بديل أوضح: get_byte(decode(hex,'hex'), j).
-- 2) مساحة الأسماء = 32^6 ≈ 1.07 مليار — احتمال التصادم مهمل على حجمنا.
-- 3) لو pgcrypto متاحة، extensions.gen_random_bytes أفضل من ناحية جودة العشوائية.
