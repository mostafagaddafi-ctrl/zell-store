# عقد TRACK-ORDER — «تتبّع طلبك» في المتجر

> **الحالة: مسودة للمراجعة.** عقد بس: مفيش كود ولا SQL في الـ PR ده.
> مبني على main `61e2a25`. الترتيب: W1 (SQL + CI) ← تطبيق على Production بموافقة المالك لوحدها ← W2 (المتجر) — §٦.

| | |
| --- | --- |
| المستوى | **كامل**: دالة جديدة على Production بتقرا `orders` و`order_items` · صفحة جديدة في المتجر بتعرض بيانات طلب |
| الموافقة | المالك 2026-10-13: التصميم زي تقرير الفحص، **ومن غير حد للمحاولات** |
| الممنوع | أي تعديل في `zell_create_order` أو `zell_get_order_receipt` أو أي جدول أو دالة موجودة · `/api/**` · الـ checkout · الفلوس · أي تشغيل على Production من غير موافقة الخطوة |

## ٠) القرار
- رابط «تتبّع طلبك» في قائمة المتجر، وصفحة فيها خانة كود الطلب. بعد إدخاله تظهر حالة الطلب وتفاصيله.
- **من غير تسجيل دخول ولا تحقق بالهاتف: الكود هو مفتاح الوصول** (قرار المالك). ومن غير حد للمحاولات (قرار المالك).
- المعروض: الحالة · التاريخ · المنتجات · الإجمالي · موعد التسليم. **من غير الاسم والتليفون والعنوان.**

## ١) ليه دالة جديدة (مش `zell_get_order_receipt`)
- الإيصال بيطلب `p_receipt_token_hash` (رمز كوكي المتصفح اللي عمل الطلب)، وبيقفل بعد `receipt_expires_at`.
- الإيصال **مابيرجّعش الحالة** (ممنوعة صراحةً في تعريفه)، وبيرجّع أول اسم وآخر ٤ أرقام من التليفون — ودول مش مطلوبين هنا.
- فـ `zell_get_order_receipt` **زي ما هي من غير أي تعديل**، والتتبّع دالة لوحدها.

## ٢) الدالة (W1)
```
zell_checkout_track_order(p_order_number text) returns jsonb
  stable · security definer · set search_path = ''
  المالك: zell_order_definer · EXECUTE لـ service_role بس (revoke من public وanon وauthenticated)
```
- **الاسم** بيبدأ بـ `zell_checkout_` (دوال المتجر)، فعدّادات `zell_order_*` (A1 = 24) و`zell_payment_*` (P1 = 24) مابتتغيّرش.
- **المدخل:** `^FLM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$` بس. أي شكل تاني **أو** طلب مش موجود = **`null` بالظبط** (نفس النتيجة، علشان الدالة ماتبقاش oracle بيفرّق بين «شكل غلط» و«مش موجود»).
- **الإسقاط (بس كده):**

| المفتاح | المصدر |
| --- | --- |
| `order_number` | `orders.order_number` |
| `status` | `orders.status` (من السبع حالات) |
| `created_at` | `orders.created_at` |
| `total_piastres` | `orders.total_piastres` |
| `items` | `order_items` بالترتيب: `product_name_ar` · `length_cm` · `width_cm` · `quantity` · `sale_unit` · `line_total_piastres` (زي الإيصال) |
| `delivery` | `{ kind: 'confirmed', date, period }` لو `delivery_confirmed_date` موجود، وإلا `{ kind: 'preferred', date, period }` لو `preferred_delivery_date` موجود، وإلا `null`. التاريخ `YYYY-MM-DD` |

- **ممنوع يرجع:** `customer_name` (ولا جزء منه) · `customer_phone` (ولا جزء منه) · `address` · `governorate` · `shipping_area` · `notes` · `internal_notes` · ملاحظات الموعد (`preferred_delivery_note` و`delivery_confirmed_note`) · الكوبون والمبالغ التفصيلية · `next_follow_up_at` · أي `*_hash` · `idempotency_key` · الدفعات.
- **ملفات W1** (الأسماء `0021tr_*` — **موافقة المراجع**): `backend/db/migrations/0021tr_track_order.sql` + `_ptest.sql` + `_verify.sql` + `_rollback.sql`، و`backend/db/ci/0021tr_sql_ci.sh` + job في `.github/workflows/ci.yml`، و`docs/maps/db-map.md`.
  - **ptest** (smoke، معاملة بترجع): الدالة مش موجودة قبل · بتتعمل · شكل غلط ومش موجود = `null` · الأثر = قبله.
  - **verify:** المالك والـ definer والـ search_path · `EXECUTE` لـ `service_role` بس (`anon` و`authenticated` مرفوضين) · مفاتيح الرد بالظبط الجدول فوق (مفيش مفتاح زيادة).
  - **CI** على Postgres مؤقت فوق شكل Production: طلبات بكل حالة · موعد مؤكد ومفضّل ومن غير موعد · سطور متر وقطعة · شكل غلط / حروف صغيرة / من غير `FLM-` = `null` (التظبيط في المتجر، مش في الدالة) · rollback · **وكل الـ verify الموجودة بعد التطبيق = PASS** (A1 · D · P1 · P2 · D2 · 0021-P strict).
  - **rollback:** `drop function` بس (مفيش داتا، فمسموح دايمًا).
  - **الأثر (IMPACT_SQL):** لو أي خانة بتعدّ دوال اتغيّرت بالدالة الجديدة، W1 بيكتب الرقم الجديد المتوقع بالظبط قبل التطبيق (قاعدة مقارنة الأثر — مراجعة #16).

## ٣) تظبيط الكود في المتجر (W2)
- قبل النداء، في السيرفر (وفي الخانة للعرض بس)، بالترتيب:
  1. شيل المسافات والشَرط (`-`).
  2. حروف كبيرة.
  3. **لو الطول ٦:** دي الستة. **لو الطول ٩ وأوله `FLM`:** آخر ٦. **غير كده = غلط** (مفيش نداء، ونفس رسالة «مش موجود»).
  4. لازم الستة من **نفس الأبجدية** (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`)، وإلا غلط.
  5. الرقم = `FLM-` + الستة.
- **مايتشالش «FLM» من الأول على طول**، لأن الكود نفسه ممكن يبدأ بـ FLM (مثلًا `FLM-FLMABC` والعميل كتب `FLMABC`).
- أمثلة (حالات الاختبار):

| اللي العميل كتبه | الرقم |
| --- | --- |
| `mrfvb3` · `FLM-mrfvb3` · ` flm mrfvb3 ` · `FLMMRFVB3` | `FLM-MRFVB3` |
| `FLMABC` (طوله ٦) | `FLM-FLMABC` |
| `flm-flmabc` (طوله ٩ وأوله FLM) | `FLM-FLMABC` |
| `FLM ABC` (٦ بعد شيل المسافة) | `FLM-FLMABC` |
| فيه `O` أو `0` أو `I` أو `1` · طول غير ٦ و٩ · طوله ٩ ومش بادئ بـ FLM | غلط — مفيش نداء |

- منطق خالص في `apps/storefront/lib/orders/trackOrder.ts` (التظبيط + حارس شكل الرد) + حالاته (`trackOrder.cases.ts`، suite في `scripts/run-cases.mjs`).

## ٤) الصفحة (W2)
- `apps/storefront/app/track/page.tsx`: خانة الكود وزرار، والنداء **من السيرفر** (Server Action في `app/track/actions.ts` ← `restRpc` بمفتاح الخدمة زي الإيصال). **الكود مايدخلش الرابط** (لا query ولا path — نفس قاعدة الإيصال ب٨).
- **رسالة واحدة** لكل الحالات الغلط (شكل غلط · مش موجود · خطأ مؤقت في القراية): «مالقيناش طلب بالكود ده. اتأكد منه وجرّب تاني.»
- **العرض:**
  - الحالة: **ثابت جديد `CUSTOMER_STATUS_LABELS` في `@zell/core`** (جنب `STATUS_LABELS` في `packages/core/src/types.ts`، و`STATUS_LABELS` بتاعة اللوحة ماتتغيّرش):

    | الحالة | للعميل |
    | --- | --- |
    | `new` | استلمنا طلبك |
    | `confirmed` | طلبك اتأكد |
    | `preparing` | بنجهّز طلبك |
    | `shipped` | طلبك في الطريق |
    | `delivered` | اتسلّم |
    | `refused` | ماتمّش الاستلام |
    | `cancelled` | الطلب اتلغى |

  - التاريخ: `created_at` بتوقيت `Africa/Cairo` (زي الإيصال).
  - المنتجات: الاسم · المقاس (`formatLength` للطول والعرض) أو العدد · إجمالي السطر (`formatPiastres`).
  - الإجمالي: `formatPiastres`.
  - الموعد: `preferredDeliveryLine` من `@zell/core` (نفس سطر الإيصال). المؤكد: «موعد التسليم: » + السطر. المفضّل: السطر + `PREFERRED_DELIVERY_PENDING` (زي الإيصال). من غير موعد: مفيش سطر.
- `robots: noindex, nofollow` للصفحة (علشان النتيجة شخصية)، ومش في الـ sitemap — **موافقة المراجع**.
- **لينك «تتبّع طلبك»** في قائمة الموبايل (`MobileMenu.tsx`) وفي الفوتر (`SiteFooter.tsx`).
- `packages/core/src/types.ts`: `CUSTOMER_STATUS_LABELS` (+ حالة إن السبع حالات ليها اسم).
- التوثيق: `docs/maps/code-map.md`.

## ٥) المخاطر
- **الكود هو المفتاح الوحيد:** أي حد معاه الكود يشوف المنتجات والإجمالي والحالة والموعد (من غير أي بيانات شخصية). الأكواد ٣٢^٦ ≈ مليار احتمال، و**مفيش حد للمحاولات** (قرار المالك). ممكن يتضاف بعدين لو احتجنا.
- الدالة قراية بس، ومابتلمسش أي دالة أو جدول موجود، فالرجوع `drop function`.

## ٦) الترتيب والموافقات
1. **PR العقد ده** ← مراجعة ← دمج بأمر المالك.
2. **W1** (SQL + CI) ← مراجعة ← دمج بأمر المالك.
3. **تطبيق W1 على Production** بموافقة المالك لوحدها: blob sha1 لكل ملف + main + IMPACT_SQL قبل/بعد + `idle_tx` = 0 + الأقفال ← ptest ← تطبيق بسطر الموافقة `owner-approval-YYYY-MM-DD-0021tr-track-order` (التاريخ = يوم التطبيق الفعلي) ← verify TR + A1 · D · P1 · P2 · D2 · 0021-P strict = PASS.
4. **W2** (المتجر) ← مراجعة ← دمج بأمر المالك، **بعد** ما W1 يتطبّق ويتحقق منه.
- كل تقرير PR فيه حالة Vercel للمتجر واللوحة على نفس الـ head.

## ٧) سجل التعديلات
- **2026-10-13 · المسودة الأولى** على main `61e2a25`، من تقرير الفحص وموافقة المالك (من غير حد للمحاولات).
- **2026-10-13 · مراجعة على `712a096` (مقبول بتعديل):** B1 — تظبيط الكود: الطول ٦ = الستة، والطول ٩ وأوله FLM = آخر ٦، وغير كده غلط، بدل شيل «FLM» من الأول على طول (الكود نفسه ممكن يبدأ بـ FLM) + حالات `FLMABC` و`flm-flmabc` و`FLM ABC` (§٣). أسماء الحالات للعميل في ثابت جديد `CUSTOMER_STATUS_LABELS` بدل `STATUS_LABELS` (§٤). موافقة على أسماء `0021tr_*` و`noindex` من غير sitemap.
