# عقد الصلاحيات الافتراضية للكائنات الجديدة (DEFAULT-PRIVILEGES)

> **الحالة: مسودة للمراجعة** (بعد مراجعة `9c597ef`: B1–B3). مفيش SQL ولا أي كتابة على Production قبل دمج العقد، وكل خطوة Production بموافقة صريحة منفصلة من المالك.
> الترتيب: العقد ← مراجعة ← **موافقة المالك على الأثر العام (§٥)** ← دمج بأمره ← B: SQL وCI من غير تطبيق ← Production (كل خطوة بأمر) ← C: التوثيق والذاكرة.

| | |
| --- | --- |
| المستوى | **الأول (مراجع + موافقة المالك):** تغيير صلاحيات في داتابيز Production |
| الأساس | zell-store main `9209d22` · `docs/contracts/BASELINE-OUTSIDE.md` §٩-2 (المهمة اتأجلت هناك كمهمة أمان لوحدها) · `backend/db/ci/platform_default_privileges.sql` (المحاكاة الحالية في CI) · `04-DB-SAFETY.md` في الذاكرة |
| قرار المالك | 2026-11-07 في شات التنفيذ: الترتيب (الصلاحيات الافتراضية الأول)، و«موافق» على القراية، و«موافق» على كتابة العقد بعد الشرح المبسّط (أي رف جديد يتعمل بابه مقفول لوحده، والموجود مايتلمسش). **الأثر العام في §٥ لسه محتاج موافقته.** |
| الممنوع | أي تغيير في صلاحيات كائن **موجود** · تعديل أي صف في `pg_default_acl` غير الصفوف التلاتة `postgres \| public` والصف العام الجديد (§٢) · أي تغيير في أدوار المنصة (`supabase_admin` · `supabase_auth_admin` · `supabase_storage_admin` …) · سحب أي حاجة من `service_role` · لمس الأسعار أو الطلبات أو `zell_create_order` |

## ٠) المشكلة
- Postgres بيدّي أي **كائن جديد** (جدول · sequence · دالة) صلاحيات تلقائية. في Production، أي كائن بيعمله الدور `postgres` (الدور اللي ملفات الـ migrations بتشتغل بيه) في `public` بياخد صلاحيات **كاملة** لـ `anon` و`authenticated` و`service_role`، والدوال الجديدة كمان EXECUTE لـ `PUBLIC` (اللي بيشمل `anon`).
- **مفيش تسريب معروف دلوقتي:** كل migration بيسحب الصلاحيات دي بنفسه صراحةً، والجداول عليها RLS. **الخطر وقائي:** أي كائن جديد ينسى صاحبه يقفله بيبقى مفتوح للزوار لوحده.

## ١) الوضع الحالي (قراية Production، 2026-11-07) — لقطة المرجع
**القراية:** بموافقة المالك («موافق»)، 2026-11-07 21:20:34–21:20:35Z، معاملة read only بتخلص بـ `rollback`، و`idle_tx = 0` قبل وبعد، وبصمة النص (sha1) `341d3a057fc077d272c608b2e507897d3a896158`. كتالوج بس، ومعاه **وجود** مفتاح إعداد واحد (من غير قيمته). نفّذها شات التنفيذ، ونتيجتها منقولة هنا بالحرف (مش قراية مستقلة من المراجع). النص:

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

**النتيجة كاملة بالحرف (24 صف `default_acl`، بنفس ترتيب الرد):**

| # | الدور \| الـ schema \| النوع | الصلاحيات الافتراضية |
| ---: | --- | --- |
| 1 | `postgres | public | S` | `{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}` |
| 2 | `postgres | public | f` | `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |
| 3 | `postgres | public | r` | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` |
| 4 | `postgres | storage | S` | `{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}` |
| 5 | `postgres | storage | f` | `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |
| 6 | `postgres | storage | r` | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` |
| 7 | `supabase_admin | extensions | S` | `{postgres=r*w*U*/supabase_admin}` |
| 8 | `supabase_admin | extensions | f` | `{postgres=X*/supabase_admin}` |
| 9 | `supabase_admin | extensions | r` | `{postgres=a*r*w*d*D*x*t*m*/supabase_admin}` |
| 10 | `supabase_admin | graphql | S` | `{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}` |
| 11 | `supabase_admin | graphql | f` | `{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}` |
| 12 | `supabase_admin | graphql | r` | `{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}` |
| 13 | `supabase_admin | graphql_public | S` | `{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}` |
| 14 | `supabase_admin | graphql_public | f` | `{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}` |
| 15 | `supabase_admin | graphql_public | r` | `{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}` |
| 16 | `supabase_admin | public | S` | `{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}` |
| 17 | `supabase_admin | public | f` | `{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}` |
| 18 | `supabase_admin | public | r` | `{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}` |
| 19 | `supabase_admin | realtime | S` | `{postgres=rwU/supabase_admin,dashboard_user=rwU/supabase_admin}` |
| 20 | `supabase_admin | realtime | f` | `{postgres=X/supabase_admin,dashboard_user=X/supabase_admin}` |
| 21 | `supabase_admin | realtime | r` | `{postgres=a*r*wdDxtm/supabase_admin,dashboard_user=arwdDxtm/supabase_admin}` |
| 22 | `supabase_auth_admin | auth | S` | `{postgres=rwU/supabase_auth_admin,dashboard_user=rwU/supabase_auth_admin}` |
| 23 | `supabase_auth_admin | auth | f` | `{postgres=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin}` |
| 24 | `supabase_auth_admin | auth | r` | `{postgres=arwdDxtm/supabase_auth_admin,dashboard_user=arwdDxtm/supabase_auth_admin}` |

ومعاها صف `settings_key`: `shipping_disabled_governorates exists` = `true` (لمهمة إعداد البداية، BASELINE-OUTSIDE §١١-6، برّه العقد ده).

**اللي اللقطة دي بتثبته:**
- **النطاق المباشر = الصفوف 1–3** (`postgres | public`).
- **مفيش ولا صف عام** (`(all schemas)`) لأي دور، ومنهم `postgres`. يعني الافتراض العام للدور `postgres` هو الافتراض المدمج في Postgres: للجداول والـ sequences = المالك بس، وللدوال = المالك + **EXECUTE لـ `PUBLIC`**.
- **الصريح والموروث:** الصلاحية الفعلية لأي كائن جديد = الافتراض العام للدور اللي عمله (المدمج، أو صف `(all schemas)` لو موجود) **+** صف الـ schema لو موجود. صف الـ schema بيضيف بس، ومابيشيلش من الافتراض العام. فدالة جديدة يعملها `postgres` في `public` النهارده: صريح من الصف 2 (`anon` · `authenticated` · `service_role`) + موروث من الافتراض المدمج (`PUBLIC`).
- **الصفوف 4–24** مرجع المقارنة برّه النطاق، ولازم تفضل بالحرف قبل وبعد كل خطوة.

## ٢) التغيير (migration لوحدها: `0027_default_privileges.sql`)
```sql
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;   -- عام (§٥): محتاج موافقة المالك
```

**النتيجة المتوقعة بالحرف (25 صف):**
- الصف 1 ← `{postgres=rwU/postgres,service_role=rwU/postgres}`
- الصف 2 ← `{postgres=X/postgres,service_role=X/postgres}`
- الصف 3 ← `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`
- **صف جديد:** `postgres | (all schemas) | f` = `{postgres=X/postgres}`
- الصفوف 4–24 بالحرف زي §١.

## ٣) اللي مابيتغيّرش
- **أي كائن موجود:** صلاحياته زي ما هي (`ALTER DEFAULT PRIVILEGES` مابيلمسش الموجود). ده بيتثبت بالبصمات في §٦-٢، مش بالوعد.
- `service_role` بيفضل بالصلاحيات الافتراضية، و`USAGE` على `public` زي ما هو.
- صفوف `pg_default_acl` 4–24 بالحرف.
- كائنات أدوار المنصة (`supabase_admin` وغيره): الافتراض العام بتاعها منفصل عن `postgres`، فمش متأثرة.
- المتجر واللوحة: مفيش أي فرق في السلوك.

## ٤) الأثر على الشغل الجاي
- أي migration جديدة بتعمل كائن محتاجه `anon` أو `authenticated` **لازم تدّيه الصلاحية صراحةً** (ودي القاعدة اللي ملفاتنا ماشية عليها أصلًا: مثلًا `grant execute … to authenticated` في 0021-P و0022 و0026).
- الأدوار التانية اللي بتعمل كائنات (`zell_catalog_definer` · `zell_purge_definer` · `zell_order_definer` …) مالهاش صفوف في §١، فالافتراض المدمج بتاعها (ومنه `PUBLIC` على الدوال) زي ما هو. ملفاتنا بتسحبه صراحةً، ومابيتغيّرش بالعقد ده.

## ٥) الأثر العام لسطر PUBLIC — محتاج موافقة المالك
- **ليه لازم:** من غير السطر الرابع، الدوال الجديدة في `public` بتفضل متاحة لـ `anon` و`authenticated` عن طريق `PUBLIC` (موروث). فالتلات سطور لوحدهم مابيقفلوش الدوال.
- **ليه عام:** Postgres مابيسمحش يتشال `PUBLIC` من schema واحدة، لأن صف الـ schema بيضيف بس. السحب لازم يبقى في الافتراض العام للدور.
- **الأثر بالظبط:** أي **دالة جديدة** يعملها الدور `postgres` في **أي schema** (منها `storage` وأي schema جديدة) مابتاخدش EXECUTE لـ `PUBLIC` تلقائيًا. في `storage` بتفضل تاخد الصريح من الصف 5 (`anon` · `authenticated` · `service_role`)، يعني اللي بيقل هو `PUBLIC` بس (أدوار تانية من غير صريح). الجداول والـ sequences برّه `public` مابتتأثرش (افتراضها المدمج مافيهوش `PUBLIC`).
- **مش بيتأثر:** أي دالة موجودة · دوال أدوار المنصة (`supabase_storage_admin` وغيره بيعملوا دوال `storage`) · الأدوار التانية.
- **الخطر:** لو حد بعدين عمل بالدور `postgres` دالة برّه `public` ومتوقّع إنها مفتوحة للكل، لازم يدّي الصلاحية صراحةً. ملفاتنا مابتعملش كائنات برّه `public`، وقاعدتها الإدّاء الصريح.
- **رأي المراجع (مراجعة `9c597ef`):** السحب موصى بيه من حيث المبدأ، ووصف `storage` بإنها «مش متأثرة بالمطلق» اتصحّح هنا. **ده مش موافقة المالك على التوسّع.**
- **المطلوب من المالك:** موافقة صريحة على الأثر العام ده، أو رفضه. لو رفض: العقد بيتعدّل يا إما يسيب الدوال من غير قفل (التلات سطور بس، ومكتوب إنهم مابيقفلوش الدوال)، يا إما تصميم تاني بأدلة واختبارات.
- `storage`: صفوفه (4–6) مابتتعدّلش. أي تعديل فيها عقد لوحده.

## ٦) ضمانات التحقق (ملزمة للمرحلة B وخطوات Production)
### ٦-١) استعلام الأثر (`0027_default_privileges_impact.sql`، read only، صف لكل قيمة)
1. صفوف `pg_default_acl` كلها بنفس شكل §١ (الدور · الـ schema · النوع · الصلاحيات بالنص).
2. **بصمات الكائنات الموجودة:** لكل schema من `public` و`storage`: عدد ثم md5 مرتّب لـ (اسم الكائن · نوعه · المالك · `relacl`) من `pg_class` (r · p · v · m · S · f)، ولـ (التوقيع · المالك · `proacl`) من `pg_proc`، ولـ (الجدول · العمود · `attacl`) لأعمدة فيها صلاحيات صريحة. وكمان لكل دوال الدور `postgres` في كل الـ schemas.
3. **مفيش كائنات تجربة:** عدد الكائنات اللي اسمها بيبدأ بـ `zell_dp_probe` في `pg_class` و`pg_proc` و`pg_namespace` = 0.
4. `current_user` و`idle_tx`.

### ٦-٢) قبل وبعد كل خطوة
| الخطوة | قبلها | بعدها (المتوقع) | الوقف |
| --- | --- | --- | --- |
| ptest (`begin … rollback`) | الأثر = §١ (البند 1) | الأثر = اللي قبله بالظبط (البنود 1–3، والتجربة 0) | أي فرق |
| التطبيق | الأثر = بعد الـ ptest | البند 1 = النتيجة المتوقعة في §٢ بالحرف · البند 2 = اللي قبله بالظبط · البند 3 = 0 | أي فرق، أو أي صف 4–24 اتغيّر |
| verify (read only) | الأثر = بعد التطبيق | الأثر = اللي قبله بالظبط | أي فرق |

- قبل كل خطوة: البصمة (git blob sha1)، وmain، ووقت UTC، و`idle_tx = 0`، و`current_user = postgres`. أي فرق أو فشل = وقف وبلاغ، من غير إعادة تلقائية.

### ٦-٣) اختبار الكائنات الجديدة فعلًا
- **في الـ ptest (Production وCI)، جوه معاملة بترجع:** بالدور `postgres` يتعمل في `public` جدول وsequence ودالة باسم `zell_dp_probe_*` بعد تطبيق الجسم، ويتفحص: `has_table_privilege` / `has_sequence_privilege` / `has_function_privilege` لـ `anon` و`authenticated` = false · لـ `service_role` = true · وEXECUTE مش موجود لـ `PUBLIC` في `proacl` · وقبل الجسم (في نفس المعاملة) نفس الفحص بيطلع النتيجة القديمة (اثبات إن الاختبار بيفرّق).
- **في CI بس:** نفس الفحص في schema تجربة جديدة (`zell_dp_probe_schema`) يعملها `postgres`، علشان يثبت الأثر العام في §٥ (الدالة من غير `PUBLIC`، والجدول زي ما هو).
- بعد الـ ptest: البند 3 في الأثر = 0.

### ٦-٤) ملفات المرحلة B
| الملف | بيعمل إيه |
| --- | --- |
| `migrations/0027_default_privileges.sql` | preflight: البند 1 = §١ بالحرف (24 صف، ومفيش صف عام)، وإلا وقف · سطر `zell.approved_by` بعد `begin;` · الجسم (§٢) · postflight: البند 1 = النتيجة المتوقعة بالحرف |
| `_ptest.sql` | نفس الجسم بالحرف (CI بيقارن md5) في معاملة بترجع، و§٦-٣ |
| `_verify.sql` | قراية بس: البند 1 = النتيجة المتوقعة، والبند 3 = 0 |
| `_rollback.sql` | بموافقة لوحدها: `grant` لـ `anon` و`authenticated` في الصفوف 1–3 بنفس الصلاحيات، و`grant execute on functions to public` في الافتراض العام. المتوقع: البند 1 = §١ بالحرف، و**الصف العام بيختفي** (Postgres بيمسح الصف لما يرجع للمدمج) |
| `_impact.sql` | §٦-١ |
| `ci/build_from_scratch.list` + `ci/0027_sql_ci.sh` + job في `ci.yml` | بناء لحد قبل 0027 بالمحاكاة الحالية (`platform_default_privileges.sql`، اللي بيتوسّع يحاكي الصفوف 1–6) · الحراس (preflight مختلف = رفض) · ptest · التطبيق · verify · الأثر قبل/بعد · §٦-٣ · الرجوع وإعادة التطبيق. ومقارنة BASELINE بتزيد الصلاحيات الافتراضية بعد البناء الكامل (اتأجلت في BASELINE §٩-2) |

## ٧) على Production (كل خطوة بأمر لوحدها)
1. الأثر قبل الـ ptest (لازم البند 1 = §١ بالحرف، وإلا وقف).
2. ptest، والأثر بعده.
3. التطبيق بقيمة علامة الموافقة `owner-approval-YYYY-MM-DD-0027-default-privileges`، والأثر بعده.
4. verify، والأثر بعده.
- المتوقع والوقف في §٦-٢.

## ٨) الرجوع
`0027_default_privileges_rollback.sql` بيرجّع البند 1 لـ §١ بالحرف (والصف العام بيختفي). مابيأثرش على أي كائن اتعمل في الفترة دي: صلاحياته بتفضل زي ما اتعمل بيها، ولو محتاج تتغيّر يبقى قرار لوحده.

## ٩) سجل التعديلات
- 2026-11-07: المسودة الأولى (شات التنفيذ، `9c597ef`)، بعد قراية Production في §١.
- 2026-11-07: بعد مراجعة `9c597ef`: **B1** النطاق اتوحّد: الأثر العام لسطر `PUBLIC` اتوصف بالظبط (ومنه `storage`) وبقى محتاج موافقة المالك (§٥)، و«الممنوع» اتعدّل · **B2** لقطة §١ كاملة (24 صف)، وغياب الصف العام، والفرق بين الصريح والموروث، والنتيجة المتوقعة والرجوع بالحرف · **B3** استعلام الأثر بقى فيه بصمات الكائنات الموجودة وعدّ كائنات التجربة، وجدول قبل/بعد لكل خطوة بالمتوقع والوقف، واختبار كائنات جديدة فعلًا (§٦).
