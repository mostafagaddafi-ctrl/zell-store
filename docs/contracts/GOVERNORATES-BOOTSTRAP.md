# عقد مفتاح المحافظات الموقوفة في البناء من الصفر (GOVERNORATES-BOOTSTRAP)

> **الحالة: معتمد (#232، اندمج على `453a2a2`)؛ التنفيذ في PR الكود #233** (النتايج في §٧). CI وتوثيق بس: مفيش SQL ولا أي قراية أو كتابة على Production في أي مرحلة.
> الترتيب: العقد ← مراجعة ← دمج بأمر المالك ← PR الكود (CI بس) ← مراجعة ← دمج بأمر المالك ← الذاكرة.

| | |
| --- | --- |
| المستوى | **الأول (مراجع + موافقة المالك):** ملفات في `backend/db/**` (baseline وCI) |
| الأساس | zell-store main `1149bbe` · `docs/contracts/BASELINE-OUTSIDE.md` §١١-6 («فجوة إعداد البداية»، برّه نطاقه كمهمة منفصلة) · `docs/contracts/DEFAULT-PRIVILEGES.md` §١ (صف `settings_key`) |
| قرار المالك | ترتيب الشغل 2026-11-07: الصلاحيات الافتراضية، ثم إعداد المحافظات، ثم الصيانة (`10-DECISIONS.md` في الذاكرة). وأمر البدء 2026-11-09: «الاتنين» (المحافظات ثم الصيانة، كل واحد في دوره) |
| الممنوع | أي تشغيل على Production (ومنه قراية قيمة المفتاح) · تعديل `schema.sql` أو أي migration تاريخي · تغيير أي دالة (`zell_save_shipping` · `zell_create_order` …) · بيانات حقيقية في CI · لمس الأسعار أو الطلبات |

## ٠) المشكلة
- مفتاح `settings.shipping_disabled_governorates` (قايمة المحافظات اللي الشحن ليها موقوف، `jsonb` array) **مالوش أي ملف بيعمله**: `schema.sql` بيعمل مفاتيح الشحن التلاتة التانية (`shipping_rates` · `shipping_default_piastres` · `free_shipping_threshold_piastres`)، والمفتاح ده اتعمل برّه الملفات.
- **على Production المفتاح موجود:** قراية كتالوج read only بموافقة المالك 2026-11-07 21:20:34Z (عقد DEFAULT-PRIVILEGES §١، صف `settings_key` = `true`). **القيمة مااتقرتش**، ومش هتتقري.
- **الأثر في CI:** الداتابيز المبنية من الملفات بس من غير المفتاح. `zell_save_shipping` (من `baseline/b2_admin_functions.sql`) محتاجة المفاتيح الأربعة وبترفض من غيره (`ZELL_SHIPPING_KEYS_MISSING`)، فاختبار الدخان (`ci/baseline_smoke.sql`) بيحط صف صناعي `'[]'` جوه معاملة بترجع علشان يعدّي، ونتيجته بتقبل `synthetic_ship_row=[tf]`. يعني البناء من الصفر مش شبه Production في النقطة دي.

## ١) التغيير (PR الكود، CI بس)
1. **ملف جديد `backend/db/baseline/b4_shipping_disabled_governorates.sql`** على شكل ملفات الـ baseline (`b3` مثلًا)، جوه `begin … commit`:
   - **الحراس بالترتيب، قبل أي تغيير:** `zell.ci_scratch = on` وإلا `ZELL_BASELINE_NOT_SCRATCH` · `current_user = postgres` وإلا `ZELL_BASELINE_B4_WRONG_ROLE` · جدول `public.settings` موجود ومفاتيح الشحن التلاتة التانية موجودة وإلا `ZELL_BASELINE_B4_REQUIRED_MISSING` · المفتاح مش موجود قبل كده وإلا `ZELL_BASELINE_B4_ALREADY_PRESENT`.
   - **الجسم:** صف واحد: `insert into public.settings (key, value) values ('shipping_disabled_governorates', '[]'::jsonb)` (`updated_at` = الافتراضي).
   - **postflight:** صف واحد بالمفتاح ده وقيمته `[]`، وإلا المعاملة كلها بترجع.
   - **القيمة `[]` صناعية** (مفيش محافظة موقوفة)، مش قيمة Production. ده نفس الشكل اللي `zell_save_shipping` بتطلبه (`jsonb_typeof = 'array'`)، ونفس القيمة اللي اختبار الدخان بيستعملها النهارده.
2. **`ci/build_from_scratch.list`:** سطر `baseline|baseline/b4_shipping_disabled_governorates.sql|…` بعد `b0` مباشرة (يعني بعد `schema.sql` اللي بيعمل الجدول والمفاتيح التلاتة)، وقبل `0002` وقبل أول ملف بيقرا المفتاح (`0006b`).
3. **`ci/build_from_scratch.sh` (S01):** قبول نتيجة الدخان يبقى `synthetic_ship_row=f` بس بدل `[tf]`، علشان يثبت إن المفتاح جاي من البناء نفسه. و`ci/baseline_smoke.sql`: تعليق الراس يتحدّث، والإدخال المشروط يفضل زي ما هو (مابيشتغلش طول ما المفتاح موجود).
4. **`ci/baseline_compare.sql`:** مفتاح جديد `settings_key:shipping_disabled_governorates` = `true` (الوجود بس، بنفس تعبير قراية §١ في عقد DEFAULT-PRIVILEGES). **القيمة مابتتقارنش** لأنها بيانات المالك ومااتقرتش.
5. **التوثيق في نفس الـ PR:** `BASELINE-OUTSIDE.md` §١١-6 (تحديث مؤرّخ من غير مسح) · `docs/maps/db-map.md` (المفتاح ومصدره في CI) · `docs/maps/big-files.md` لأي ملف كبير بيتغيّر · العقد ده (§٧ النتايج).

## ٢) اللي مابيتغيّرش
- **Production:** مفيش أي حاجة بتتطبّق أو تتقري. `b4` بيرفض قبل أي تغيير لو اتشغّل برّه داتابيز CI (`zell.ci_scratch`).
- مفيش تغيير في أي دالة، ولا في `schema.sql`، ولا في أي migration تاريخي.
- **المتجر واللوحة:** مفيش أي فرق في السلوك (مفيش تغيير في `apps/`). الدمج بينشر التطبيقين بنفس الكود.
- **اختبارات تانية:** `0021d_sql_ci.sh` و`0021p1_sql_ci.sh` بيبنوا داتابيز بتاعتهم ومابيقروش القايمة (وبيدخّلوا المفتاح بنفسهم). `0025_flows.sql` و`0025_core_parity.mjs` بيدخّلوه بـ `on conflict (key) do update`، فمفيش تعارض. السويتات اللي بتبني من القايمة (0022 لحد 0027 وBASELINE) هتلاقي المفتاح بقيمة `[]`؛ ومفيش ملف فيهم بيدخّله أو بيعدّ صفوف `settings` كلها (اتدوّر في `backend/db/ci/` وملفات الـ ptest/verify/flows على main `1149bbe`). أي فشل يظهر في CI = وقف وبلاغ.

## ٣) ضمانات CI (ملزمة لـ PR الكود)
- **BASELINE (`build_from_scratch.sh`):** البناء بـ `b4` · `COMPARE PASS settings_key:shipping_disabled_governorates` · **G2** إعادة `b4` = `ZELL_BASELINE_B4_ALREADY_PRESENT` والبصمة ثابتة · **G3** من غير `zell.ci_scratch` = `ZELL_BASELINE_NOT_SCRATCH` قبل أي تغيير · **G4** على داتابيز فاضية = `ZELL_BASELINE_B4_REQUIRED_MISSING` قبل أي تغيير (اللوبات الموجودة بتغطي كل سطور `baseline` في القايمة) · **S01** `save_shipping=t ship_keys=4 synthetic_ship_row=f synthetic_row_rolled_back=t`.
- **باقي السويتات** (0022 · 0023 · 0024 · 0025 · 0026 · 0027 وPRODUCT-DELETE) تعدّي على الـ head.
- **مفيش `[skip ci]`**، والنتايج بسطورها في وصف الـ PR.

## ٤) Production
- **مفيش خطوات.** المفتاح موجود على Production أصلًا، والملف ده للبناء من الصفر في CI بس.

## ٥) الرجوع
- revert لـ PR الكود بيرجّع CI لحالته (الصف الصناعي في الدخان بيرجع يشتغل لوحده). مفيش أثر على Production.

## ٦) برّه النطاق
- قراية أو مقارنة **قيمة** المفتاح على Production.
- أي «إعداد بداية» لمتجر جديد من الملفات على Production، أو نقل المفتاح لـ migration بتتطبّق.
- باقي الصيانة (big-files · README · 0023 C02 · `pg_depend`): بأمرها وفي دورها.

## ٧) النتايج
- **PR الكود #233** على main `453a2a2`. CI على الرأس `367727648b28538ed2f35808b630f652f83a3383` (run `42543955991`): **success، 23 نجحت و8 اتخطّت**؛ السويتات اللي اشتغلت: BASELINE-OUTSIDE · 0023 · 0024 · 0025 · 0026 · 0027 · PRODUCT-DELETE · البناء.
- **BASELINE-OUTSIDE:** `LIST steps=48 baseline=5` · `B03 baseline baseline/b4_shipping_disabled_governorates.sql` · `COMPARE PASS settings_key:shipping_disabled_governorates` · `C01 … (43 of 43 checks)` · G2 وG3 وG4 لـ b4 · **G5** الدور الغلط (`supabase_admin`) · **G6** مفتاح ناقص (`free_shipping_threshold_piastres`) · `ZELL_SMOKE … save_shipping=t ship_keys=4 synthetic_ship_row=f synthetic_row_rolled_back=t` · `ZELL_BASELINE_BUILD_RESULT pass=77 fail=0`.
- **أول تشغيل** (الرأس `16ff3cd`، run `42543702023`) فشل في تجهيز داتابيز G6 بس: الداتابيز ملك `supabase_admin`، و`postgres` مالوش CREATE على `public` (`permission denied for schema public`). الإصلاح: الجدول بيتعمل بـ `$SUPER` ويتسلّم لـ `postgres`، زي `settings` في البناء. مفيش تغيير في b4 ولا في المتوقع.
- **مفيش أي تشغيل على Production**، ومفيش قراية لقيمة المفتاح.
- (الرأس النهائي بيزوّد العقد ده بس؛ CI بتاعه في وصف الـ PR.)

## ٨) سجل التعديلات
- 2026-11-09: المسودة الأولى (شات التنفيذ)، بعد أمر المالك «الاتنين»، على main `1149bbe`.
- 2026-11-09: مقبول من المراجع على `4b46234` من غير Blocking (Non-blocking: اختبار الدور الغلط ومفتاح ناقص في PR الكود = G5 وG6)، واندمج بأمر المالك («يلا ماشي») على `453a2a2`.
- 2026-11-09: PR الكود #233: الحالة و§٧ النتايج.
