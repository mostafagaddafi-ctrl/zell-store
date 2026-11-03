# عقد INVENTORY-REMOVAL — شيل المخزون (0020 و0020-S) من myzill وأرشفته

> **الحالة: مسودة للمراجعة.** عقد بس: مفيش كود ولا SQL ولا أي تشغيل على Production في الـ PR ده.
> مبني على main `b38b7b4` (#192). علامة الرجوع: الوسم `pre-inventory-removal` على نفس الـ commit.
> الترتيب (§٧): العقد ← الأرشيف ← A (اللوحة) ← B (الداتابيز) ← C (التوثيق). كل خطوة PR لوحده ومراجعة وأمر صريح من المالك.

| | |
| --- | --- |
| المستوى | **كامل**: شيل كود من اللوحة · migration بيشيل جداول ودوال ودور من Production · تعديل دوال حذف المنتج (0022) |
| الموافقة | المالك 2026-11-03 في الشات: «نشيله» + أرشيف في ريبو لوحده (الاسم سابه للمنفّذ) |
| الممنوع | أي تعديل في الطلبات أو الدفعات أو الشحن أو التتبّع أو الكوبونات أو `zell_create_order` · أي تعديل في 0021-P (الكتالوج والقوالب والعدّادات) · أي تشغيل على Production من غير موافقة الخطوة |

## ٠) القرار وليه
- المخزون (الموردين · المشتريات · رصيد أول المدة · الدفعات/lots) **مش مستخدم**: البيانات على Production تجارب بس، والمالك مش عايز يحتفظ بيها.
- **حجمه** على `b38b7b4`: 72 ملف في اللوحة (**11,170 سطر**، حوالي 30% من كود اللوحة) + 12 ملف migration و SQL CI لوحده.
- **أثره على الصيانة:** مربوط بجدول المنتجات (مفاتيح + trigger `zinv_products_sale_unit`) وبدوال حذف المنتج (0022)، وله suites في حالات اللوحة وjob SQL في CI وفاحص لوحده (`check-inventory-session.mjs`)، وكل شات لازم يفهمه علشان مايبوّظهوش.
- **الإخفاء بس مش كفاية:** الكود يفضل موجود ولازم يفضل شغّال ويتختبر. القرار: **إزالة كاملة على مراحل، بعد أرشيف كامل.**
- المخزون **مش مربوط** بالطلبات ولا الدفعات ولا الشحن ولا التتبّع ولا الكوبونات (اتأكد من الكود على `b38b7b4` — §٢).

## ١) اللي بيفضل زي ما هو (برّه النطاق)
- دورة الطلب والدفعات ورسوم التأكيد والشحن السريع والتتبّع والكوبونات وحذف المنتج (غير التعديل في §٥-٢).
- **0021-P كله:** المحرك `erp_*` والمحوّل `zell_erp_*` وكتالوج الصلاحيات (فيه `zell.inventory0020.view` و`zell.inventory0020.edit`). **الصلاحيتين دول بيفضلوا في الكتالوج وفي `lib/access/capabilities.ts`** علشان تكافؤ الكود والكتالوج (`check-capabilities.mjs`) وعدّادات verify 0021-P مايتغيّروش. مابقاش في أي page أو action بيستخدمهم.
- ملفات migrations 0020 و0020-S **بتفضل في الريبو** (تاريخ). الشيل بيتم بـ migration جديد للأمام، مش بمسح ملفات قديمة.
- عمود `products.sale_unit` نفسه وكل المنتجات.

## ٢) الربط الحالي (من الكود على `b38b7b4`)
**في اللوحة — ملفات المخزون نفسها (بتتشال في A):**
- `app/(dashboard)/inventory/**` (8) · `components/inventory/**` (23) · `lib/inventory/**` (31) · `lib/inventoryActions.ts` · `lib/data/*inventory*` (4) · `lib/mutations/*inventory*` (3) · `lib/client/useInventoryIntent.ts` · `scripts/check-inventory-session.mjs`.

**ملفات تانية بتستورد من `lib/inventory` (لازم تفضل شغّالة بنفس السلوك):**
| الملف | بيستخدم إيه |
| --- | --- |
| `lib/data/client.ts` | `INVENTORY_SENTINELS` (`lib/inventory/sentinels`) |
| `lib/data/reads.ts` | `InventoryCatalog` وغيره (`lib/inventory/catalog`) |
| `lib/mutations/products.ts` | `INVENTORY_ERRORS` (رسالة 45217 بتاعة trigger نوع البيع) |
| `lib/client/usePreview.ts` | `InventoryResult` + أدوات المعاينة (`lib/inventory/preview`) |
| `lib/client/useLineCards.ts` | `keysOpenAfterCloseAll` (`lib/inventory/lineIssues`) |

**الإطار والفحوص:** `components/shell/AdminShell.tsx` (لينكات القايمة) · `lib/access/manifest.ts` + `manifest.cases.ts` (actions المخزون، `INVENTORY_OWNER_ONLY_MESSAGE`، الحالة M9) · `lib/access/wrappers.ts` (`mapFailure`) · `scripts/check-access.mjs` و`check-access-manifest.mjs` (إعداد `lib/inventory/rpc`) · `scripts/run-cases.mjs` (suites المخزون) · `.github/workflows/ci.yml` (خطوة الفاحص + job `sql-0020s`).

**في الداتابيز (من `docs/maps/db-map.md`):**
- 10 جداول: `inventory_locations` · `suppliers` · `purchase_docs` · `purchase_doc_lines` · `purchase_doc_charges` · `opening_stock_docs` · `opening_stock_lines` · `stock_lots` · `inventory_commands` · `inventory_audit_log` — و4 sequences.
- 23 دالة `zell_inv_*` + 23 `zell_inv_session_*` + الدوال المساعدة ودوال الـ triggers، والدور `zell_inventory_definer`.
- **على المنتجات:** trigger `zinv_products_sale_unit` (45217) والمفاتيح من جداول المخزون لـ `products`.
- **0022 (حذف المنتج):** `zell_inv_product_stock_ref_exists` (مالكها `zell_inventory_definer`، بينادي `zell_inv_product_has_stock_refs`) بتستخدمها دوال الحذف ومعاينته.
- **CI:** `build_from_scratch.list` (سطرين 0020) · `0022_sql_ci.sh` (بيستخدم verify 0020) · `call_contract_policy.json` (`INVENTORY_SESSION_FUNCTIONS`) · `baseline_compare.sql`.
- الأعداد والأسماء بالظبط **بتتأكد على Production بقراية لوحدها بموافقة** (§٧ خطوة ٤) قبل كتابة SQL المرحلة B.

## ٣) الأرشيف — قبل أي حذف
- ريبو **Private** اسمه `myzill-mini-erp`. **المالك بيعمله** من GitHub (New repository، Private، فاضي)، لأن إنشاء ريبو قرار حساب.
- المنفّذ يرفع فيه **نسخة زي ما هي من الوسم `pre-inventory-removal`**: كل ملفات المخزون في §٢ (اللوحة) + ملفات 0020 و0020-S (migrations وCI) + `docs/contracts/0020-S.md` + الأجزاء المتعلقة من `db-map` و`code-map` و`ERP-PLAN`، بنفس المسارات.
- **README** في الأرشيف: إيه ده · جه منين (الريبو والوسم والـ commit) · إنه **مش بيشتغل لوحده** (معتمد على اللوحة والصلاحيات وجدول المنتجات) · إيه اللي محتاجه علشان يتبني مشروع مستقل.
- **مفيش بيانات** في الأرشيف (لا Production ولا تجارب)، ولا أسرار.
- المرحلة A مابتبدأش غير بعد ما الأرشيف يتراجع (المحتوى = الوسم بالبصمات).

## ٤) المرحلة A — اللوحة (كود بس، مفيش SQL)
1. **شيل** ملفات المخزون في §٢ والصفحات ولينكات القايمة.
2. **نقل الحاجات المشتركة** من `lib/inventory` لمكان محايد **بنفس السلوك بالحرف** قبل الشيل: الـ sentinels والأخطاء المشتركة لـ `lib/data` / `lib/mutations`، وأدوات المعاينة والكروت لـ `lib/client`. الباقي اللي بيخص المخزون بس بيتشال. حالة لكل حاجة اتنقلت.
3. **رسالة 45217** في `lib/mutations/products.ts` تفضل لحد المرحلة B (الـ trigger لسه موجود على Production).
4. **الفحوص:** `manifest.ts` والأعداد في `manifest.cases.ts` وبصمة الـ blob · `check-access*.mjs` · `run-cases.mjs` · شيل `check-inventory-session.mjs` وخطوته من CI. فاحص الصلاحيات `enforce` لازم يفضل `findings=0`.
5. **الداتابيز ماتتلمسش:** الجداول والدوال بتفضل على Production لحد B، ومحدش بيناديها.
6. **الرجوع:** revert الـ PR (مفيش SQL).

## ٥) المرحلة B — الداتابيز (migration للأمام)
### ٥-١ الملف `backend/db/migrations/0023_inventory_removal.sql` (+ ptest + verify + CI)
- **preflight:** المتصل `postgres` · سطر الموافقة · المرحلة A منشورة · **البيانات = اللي اتقرت في §٧ خطوة ٤ بالحرف** (أعداد كل جدول، ومفيش مستند `posted` ولا lot)، وأي اختلاف = وقف.
- **الترتيب جوه معاملة واحدة:**
  1. دوال حذف المنتج ومعاينته (0022): نسخة جديدة من التعريف الحي (ببصمته) **من غير** فحص المخزون، لأن مفيش مخزون. السلوك لأي منتج = زي النهارده بالظبط (المخزون فاضي من الإيصالات).
  2. `drop` `zell_inv_product_stock_ref_exists` و`zell_inv_product_has_stock_refs`.
  3. `drop trigger zinv_products_sale_unit` ودالته.
  4. دوال `zell_inv_session_*` ثم `zell_inv_*` ثم المساعدة ودوال الـ triggers ثم الجداول (بالمفاتيح) والـ sequences والـ policies.
  5. الدور `zell_inventory_definer`: بعد ما يبقى مالوش أي كائن ولا صلاحية (والـ postflight بيتأكد).
- **postflight + verify:** مفيش أي كائن بالأسماء دي · `products` والطلبات زي ما هم · verify A1 · D · P1 · P2 · D2 · TR · 0022 · 0021-P strict = PASS · الأثر (IMPACT) الخانات المتوقعة مكتوبة قبل التطبيق.
- **الرجوع:** **مفيش rollback SQL** (البيانات تجارب والمالك مش عايزها). الرجوع = الـ backup الكامل اللي قبل التطبيق + الأرشيف. لازم موافقة المالك على ده صريحة قبل التطبيق.
### ٥-٢ CI والبناء من الصفر
- `build_from_scratch.list`: 0020 و0020-S بيفضلوا (التاريخ) و0023 بيتضاف بعدهم، فالبناء من الصفر بيطلع نفس شكل Production.
- job `sql-0020s` بيتشال. `0022_sql_ci.sh` و`call_contract_policy.json` و`baseline_compare.sql` بيتعدّلوا بنفس الـ PR.
- job جديد `sql-0023` (ptest · تطبيق · verify · حذف منتج قبل/بعد) على Postgres مؤقت فوق شكل Production.

## ٦) المرحلة C — التوثيق
- `db-map` و`code-map` و`big-files` و`README` (سطر «المخزون اتشال واتنقل لـ `myzill-mini-erp`»).
- **ERP-PLAN:** أرقام «0022» (الفلوس) و«0023» (الموظفين) بتتغيّر لتسميات من غير رقم migration، لأن 0022 بقى حذف المنتج و0023 هيبقى الإزالة. مصير باقي مراحل الـ ERP (حجز · قص · مرتجعات · خزن · موظفين · تقارير) **قرار المالك** (§٩).
- الذاكرة (`myzill-memory`): القرار في `10-DECISIONS`، ومكان الأرشيف والوسم في `START.md`.

## ٧) الترتيب والموافقات (كل خطوة بأمر صريح لوحدها)
1. PR العقد ده ← مراجعة ← دمج.
2. المالك يعمل ريبو `myzill-mini-erp` (Private) ← المنفّذ يرفع الأرشيف ← مراجعة.
3. **المرحلة A** ← مراجعة كاملة ← دمج (= نشر اللوحة) ← المالك يجرّب اللوحة.
4. **قراية Production بموافقة لوحدها:** أعداد جداول المخزون وكائناته وتعريف دوال حذف المنتج ببصماتها (قراية بس، من غير بيانات).
5. **المرحلة B** (SQL + CI) ← مراجعة كاملة ← دمج.
6. Production: ptest ← **backup كامل** ← تطبيق بسطر `owner-approval-YYYY-MM-DD-0023-inventory-removal` ← verify — كل واحدة لوحدها، والوقت بالـ UTC لحظة التشغيل.
7. **المرحلة C** ← مراجعة ← دمج.

## ٨) المخاطر
- **حذف المنتج:** لو التعديل في §٥-١ خطوة ١ غلط، حذف المنتج يقف أو يتصرّف غلط. الحماية: التعريف الحي ببصمته + مقارنة قديم/جديد في CI + verify 0022.
- **حاجات مشتركة اتشالت بالغلط:** الحماية: §٤ خطوة ٢ + typecheck + كل حالات اللوحة.
- **الرجوع بعد B صعب:** backup + أرشيف بس. علشان كده B بعد ما اللوحة تشتغل من غير المخزون فترة.

## ٩) أسئلة للمالك
1. **باقي مراحل الـ ERP** في ERP-PLAN (حجز · قص · مرتجعات · خزن · مصاريف · موظفين · تقارير): تفضل خطة لبعدين، ولا تتشال وتتنقل للأرشيف؟
2. **بيانات التجارب** في المخزون (مورد واحد ومستندين ملغيين): تتمسح من غير تصدير؟ (الافتراضي: أيوه، زي ما قال المالك.)
3. **اسم الأرشيف** `myzill-mini-erp`: تمام؟

## ١٠) سجل التعديلات
- **2026-11-03 · المسودة الأولى** على main `b38b7b4`، من قرار المالك في الشات.
