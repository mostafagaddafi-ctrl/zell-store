# عقد الصلاحيات الافتراضية للكائنات الجديدة (DEFAULT-PRIVILEGES)

> **الحالة: مسودة للمراجعة.** مفيش SQL ولا أي كتابة على Production قبل دمج العقد، وكل خطوة Production بموافقة صريحة منفصلة من المالك.
> الترتيب: العقد ← مراجعة ← دمج بأمر المالك ← B: SQL وCI من غير تطبيق ← Production (كل خطوة بأمر) ← C: التوثيق والذاكرة.

| | |
| --- | --- |
| المستوى | **الأول (مراجع + موافقة المالك):** تغيير صلاحيات في داتابيز Production |
| الأساس | zell-store main `9209d22` · `docs/contracts/BASELINE-OUTSIDE.md` §٩-2 (المهمة دي اتأجلت هناك كمهمة أمان لوحدها) · `backend/db/ci/platform_default_privileges.sql` (بيحاكي الوضع الحالي في CI) |
| قرار المالك | 2026-11-07 في شات التنفيذ: الترتيب (الصلاحيات الافتراضية الأول، ثم المحافظات، ثم الصيانة)، وموافقة على القراية، و«موافق» على كتابة العقد بعد الشرح المبسّط (أي رف جديد يتعمل بابه مقفول لوحده، والموجود مايتلمسش) |
| الممنوع | أي تغيير في صلاحيات كائن **موجود** · أي تغيير لأدوار المنصة (`supabase_admin` · `supabase_auth_admin`) أو لـ schemas غير `public` · سحب أي حاجة من `service_role` · لمس الأسعار أو الطلبات أو `zell_create_order` |

## ٠) المشكلة
- Postgres بيدّي أي **كائن جديد** (جدول · sequence · دالة) صلاحيات تلقائية حسب «الصلاحيات الافتراضية» (`pg_default_acl`) بتاعة الدور اللي عمله.
- في Production، أي كائن بيعمله الدور `postgres` (ده الدور اللي ملفات الـ migrations بتشتغل بيه) في `public` بياخد تلقائيًا صلاحيات **كاملة** لـ `anon` و`authenticated` و`service_role`.
- **مفيش تسريب معروف دلوقتي:** كل migration بيسحب الصلاحيات دي بنفسه صراحةً، والجداول عليها RLS. **الخطر وقائي:** أي كائن جديد ينسى صاحبه يقفله بيبقى مفتوح للزوار لوحده.

## ١) الوضع الحالي (قراية Production، 2026-11-07)
**القراية:** بموافقة المالك («موافق»)، 2026-11-07 21:20:34–21:20:35Z، معاملة read only بتخلص بـ `rollback`، و`idle_tx = 0` قبل وبعد، وبصمة النص (sha1) `341d3a057fc077d272c608b2e507897d3a896158`. كتالوج بس، ومعاه **وجود** مفتاح إعداد واحد (من غير قيمته). النص بالحرف:

```sql
begin;
set transaction read only;
set local statement_timeout = '15s';
set local idle_in_transaction_session_timeout = '15s';
set local search_path = pg_catalog, pg_temp;
select x.section, x.k, x.v from (
  select 'default_acl'::text as section,
         pg_catalog.pg_get_userbyid(d.defaclrole) || ' | ' || coalesce(n.nspname, '(all schemas)') || ' | ' || d.defaclobjtype::text as k,
         d.defaclacl::text as v
  from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
  union all
  select 'settings_key', 'shipping_disabled_governorates exists',
         (exists (select 1 from public.settings s where s.key = 'shipping_disabled_governorates'))::text
) as x(section, k, v)
order by x.section collate "C", x.k collate "C";
rollback;
```

**النتيجة للنطاق ده (الدور `postgres` في `public`):**

| النوع | الصلاحيات الافتراضية بالحرف |
| --- | --- |
| `r` (جداول وviews) | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` |
| `S` (sequences) | `{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}` |
| `f` (دوال) | `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |

- **برّه النطاق (اتقرا ومش هيتغيّر):** نفس الشكل للدور `postgres` في `storage`، والدور `supabase_admin` في `public` و`graphql` و`graphql_public` و`extensions` و`realtime`، و`supabase_auth_admin` في `auth`. دول بتوع المنصة، وتغييرهم ممكن يكسر Supabase نفسها، وملفاتنا مابتعملش كائنات بيهم.
- **الدوال وPUBLIC:** Postgres بيدّي أي دالة جديدة EXECUTE لـ `PUBLIC` افتراضيًا (افتراض عام مش ظاهر في الجدول، والإعداد الخاص بـ schema بيتضاف عليه ومابيشيلوش). ملفاتنا بتسحبه صراحةً.
- مطابق لاستنتاج خطوة 0 في BASELINE-OUTSIDE (2026-10-24) اللي `platform_default_privileges.sql` بيحاكيه.
- **مفتاح `shipping_disabled_governorates`: موجود.** (ده لمهمة إعداد البداية، BASELINE-OUTSIDE §١١-6، ومش جزء من العقد ده.)

## ٢) التغيير (migration لوحدها: `0027_default_privileges.sql`)
```sql
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;   -- §٥ (أ): محتاج قرار المراجع
```

**النتيجة المتوقعة بعد التطبيق (الدور `postgres`):**
- `public | r` = `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` · `public | S` = `{postgres=rwU/postgres,service_role=rwU/postgres}` · `public | f` = `{postgres=X/postgres,service_role=X/postgres}`.
- سطر عام جديد (من غير schema) للدوال: `{postgres=X/postgres}` (يعني من غير `PUBLIC`).
- باقي الصفوف (برّه النطاق) زي ما هي بالحرف.

## ٣) اللي مابيتغيّرش
- **أي كائن موجود:** صلاحياته زي ما هي. التغيير بيأثر على الجديد بس.
- `service_role` بيفضل بالصلاحيات الافتراضية (السيرفر بيستخدمه)، و`USAGE` على schema `public` زي ما هو.
- أدوار المنصة والـ schemas التانية.
- المتجر واللوحة: مفيش أي فرق في السلوك.

## ٤) الأثر على الشغل الجاي
- أي migration جديدة بتعمل كائن محتاجه `anon` أو `authenticated` **لازم تدّيه الصلاحية صراحةً** (ودي القاعدة اللي ملفاتنا ماشية عليها أصلًا: مثلًا `grant execute … to authenticated` في 0021-P و0022 و0026).
- الكائنات اللي بيعملها دور تاني غير `postgres` (زي `zell_catalog_definer` و`zell_purge_definer` و`zell_order_definer`) مالهاش صلاحيات افتراضية في القراية، فمش متأثرة.

## ٥) قرارات محتاجة المراجع
- **(أ) EXECUTE لـ PUBLIC على الدوال:** السطر الرابع في §٢ عام لكل الـ schemas للدور `postgres` (Postgres مابيسمحش يتشال من schema واحدة). الاقتراح: يدخل، لأن `PUBLIC` بيشمل `anon`، وكل دوالنا بتسحبه صراحةً. البديل: نسيبه ونكتفي بالتلات سطور.
- **(ب) `storage`:** برّه النطاق (المنصة بتدير الـ schema ده). لو المراجع عايزه، يبقى عقد لوحده.

## ٦) الملفات (المرحلة B، من غير تطبيق)
| الملف | بيعمل إيه |
| --- | --- |
| `migrations/0027_default_privileges.sql` | preflight: صفوف `pg_default_acl` للدور `postgres` بالنص = §١ بالحرف، وإلا وقف · سطر `zell.approved_by` بعد `begin;` · الجسم (§٢) · postflight: = النتيجة المتوقعة بالحرف، وباقي الصفوف زي ما هي |
| `_ptest.sql` | نفس الجسم بالحرف (CI بيقارن md5) في معاملة بترجع، وفحص النتيجة، وكائن تجربة جديد (جدول وsequence ودالة) بيتأكد إن `anon` و`authenticated` و`PUBLIC` مالهمش صلاحية و`service_role` ليه |
| `_verify.sql` | قراية بس: صفوف الدور `postgres` = النتيجة المتوقعة، والصفوف برّه النطاق = §١ |
| `_rollback.sql` | بيرجّع §١ بالحرف (`grant` بنفس الصلاحيات، والسطر العام بيرجع `PUBLIC`)، بموافقة لوحدها |
| `_impact.sql` | نفس نص القراية في §١ (قبل وبعد كل خطوة) |
| `ci/build_from_scratch.list` + `ci/0027_sql_ci.sh` + job في `ci.yml` | بناء لحد قبل 0027 بالمحاكاة الحالية · الحراس · ptest · التطبيق · verify · الكائن التجريبي · الرجوع وإعادة التطبيق. ومقارنة BASELINE بتزيد الصلاحيات الافتراضية بعد البناء الكامل (مقارنة اتأجلت في BASELINE §٩-2) |

## ٧) على Production (كل خطوة بأمر لوحدها)
1. الأثر قبل (نص §١ بالحرف): لازم يطابق §١، وإلا وقف.
2. ptest (`begin … rollback`).
3. التطبيق بقيمة علامة الموافقة `owner-approval-YYYY-MM-DD-0027-default-privileges`.
4. verify.
5. الأثر بعد: صفوف الدور `postgres` = النتيجة المتوقعة، والباقي = §١.
- البصمة (git blob sha1) وmain ووقت UTC و`idle_tx = 0` بيتسجّلوا قبل كل خطوة.

## ٨) الرجوع
`0027_default_privileges_rollback.sql` بيرجّع §١ بالحرف. مابيأثرش على أي كائن اتعمل في الفترة دي (صلاحياته بتفضل زي ما اتعمل بيها).

## ٩) سجل التعديلات
- 2026-11-07: المسودة الأولى (شات التنفيذ)، بعد قراية Production في §١.
