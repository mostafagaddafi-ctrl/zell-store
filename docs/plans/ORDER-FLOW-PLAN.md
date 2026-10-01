# FUTURE IMPLEMENTATION PLAN — NOT EXECUTED

> **خطة تنفيذ مستقبلية — لم تُنفّذ.**
>
> الوثيقة دي **خطة فقط**. مفيش كود اتكتب، مفيش SQL اتنفّذ، مفيش تغيير على Production،
> ومفيش تفعيل لإرسال الطلب.
>
> | | |
> |---|---|
> | الحالة | **معتمدة — كل القرارات مقفولة. جاهزة للدمج.** |
> | `main` وقت الفحص | `70474369b4940896c0198fcbb1628fe7b2335b1c` |
> | البيئة المفحوصة | Supabase Production (قراءة فقط) |
> | النطاق | `apps/storefront` + `packages/core` + migrations جديدة |
> | خارج النطاق | `apps/admin`، رفع الصور، الأدوار، الإعدادات التشغيلية |
> | المرحلة اللي بعدها | migrations الطلب كمرحلة منفصلة بعد دمج الوثيقة دي |

---

## ملخّص تنفيذي

تشغيل الطلب الحقيقي محتاج ٤ حاجات مترتبة: **(١)** ٤ أعمدة جديدة على `orders` و**دالتين**
في الداتابيز، **(٢)** راوت `POST /api/orders` واحد في المتجر، **(٣)** صفحة إيصال محمية
**بكوكي `HttpOnly` مقيّد بمسار الطلب، بيتضبط في نفس رد الـAPI** — **صفر أسرار في أي
URL وصفر أسرار في أي JSON**، **(٤)** إشعار تليجرام بعد الالتزام. كل ده خلف بوّابة
`ORDERS_ENABLED` مقفولة افتراضياً.

**سطح الداتابيز كله دالتين وبس:**

    zell_create_order(...)
    zell_get_order_receipt(p_order_number, p_receipt_token_hash)

**وسطح الـHTTP راوت واحد وبس:** `POST /api/orders`.

أهم ٤ حقائق من الفحص:

1. **ولا واحدة من مسوّدات migrations الطلب اتنفّذت على Production** — مؤكَّد من
   الداتابيز نفسها، مش من التعليقات.
2. **المسوّدات القديمة `0005a/0005b/0005c` مرفوضة للتنفيذ** ومحتاجة استبدال كامل.
3. جدول `settings` فيه خانة لتوكن بوت تليجرام — **مكان تخزين خاطئ لسر**.
4. `shipping_disabled_governorates` بتتكتب من اللوحة و**مالهاش أي أثر** لا في المتجر
   ولا في مسودة المعاملة.

---

## 0. حالة البداية والقرارات

### 0.1 مفيش أي migration للطلب على Production

| الملف | المفروض يعمل إيه | موجود في Production؟ |
|---|---|---|
| `backend/db/migrations/0005a_generate_order_number.sql` | `generate_order_number('FLM')` | لا |
| `backend/db/migrations/0005b_order_idempotency.sql` | `idempotency_key` + `request_hash` + فهرس فريد جزئي | لا |
| `backend/db/migrations/0005c_create_order_function.sql` | دور `zell_definer` + سياسات RLS + `create_order` | لا |

تأكيد مباشر من الداتابيز:

- دوال `public` الموجودة: `zell_reorder_product_images`، `zell_reorder_products`،
  `zell_save_content`، `zell_save_identity`، `zell_save_shipping`،
  `zell_set_primary_product_image`، `zell_valid_benefits` — **مفيش** أي دالة طلبات.
- فهارس `orders`: `orders_pkey`، `orders_order_number_key`، `orders_created_at_idx`،
  `orders_phone_idx`، `orders_status_idx` — **مفيش** فهرس idempotency.
- أعمدة `orders`: `id, order_number, status, customer_name, customer_phone,
  governorate, address, notes, subtotal_piastres, shipping_piastres, total_piastres,
  notified_at, notify_error, created_at, updated_at, internal_notes`.
- أدوار `zell%`: **صفر**. سياسات RLS: **صفر** (RLS مفعّل من غير أي policy).
- `orders`: **صفر صفوف** — وده اللي بيخلّي الاختبار على Production مقبول (ب٤).

### 0.2 ملاحظات بنية مؤثّرة

1. `orders.order_number`: `text NOT NULL UNIQUE` **من غير default** → الرقم يتولّد في
   نفس عبارة الإدخال.
2. `orders.updated_at`: `NOT NULL default now()` و**مفيش trigger** في المشروع كله.
   أي `update` لازم يبعت `updated_at` صريح.
3. `order_items.length_cm` و`width_cm`: `NOT NULL` + `CHECK > 0` → العقد خاص بالبيع
   بالمتر الطولي. نماذج التسعير التانية **خارج النطاق** تماماً
   (`docs/future/MERCHANDISING-EXTENSIBILITY.md`).
4. `order_items.product_id` nullable + لقطة مجمّدة → حذف منتج ما بيفسدش طلب قديم.
5. مسوّدات `backend/` مكتوبة **لمنفّذ Retool** (`supabase.query(...)` و`retoolEmail`) —
   مرجع تاريخي، مش كود قابل للنشر (ب٥).
6. `packages/core/src/orderNumber.ts` فيه `isValidOrderNumber` — يُستخدم للتحقق من شكل
   رقم الطلب في الواجهة والسيرفر.
7. المتجر فيه `restGet` بس — **مفيش أي helper كتابة ولا RPC**.
8. `CheckoutForm.tsx`: الزر `disabled` ثابت + بانر «لسه مش مفعّل»، و`onSubmit` بيعمل
   `setTouched(true)` وخلاص.
9. `REVALIDATE_SECONDS = 300` → الصفحة ممكن تعرض سعر عمره ٥ دقايق. «السعر النهائي من
   الداتابيز» **شرط إلزامي**، مش تحسين.
10. الـAPI route الوحيد في الريبو هو راوت صور الأدمن — نفس النمط والحدود هو المرجع.
11. `PUBLIC_SETTING_KEYS` allowlist بـ٨ مفاتيح بتتستخدم مرتين — `notify_email`
    و`telegram_*` **ما بيوصلوش** للمتجر. يفضل كما هو.

### 0.3 الفرجات المكتشفة

**(أ) سر في الداتابيز.** `settings` فيه `telegram_bot_token` و`telegram_chat_id`
(الاتنين `""` حالياً). خانة لتوكن بوت في جدول بيتعدّل من اللوحة تخالف قاعدة «مفيش
أسرار في أي مكان».

**(ب) المحافظات المقفولة مش بتتقفل فعلاً.** `shipping_disabled_governorates` موجود
(`[]` حالياً) و`zell_save_shipping` بيكتبه، بس المتجر ما يقراهوش
(`governorates` = مفاتيح `shipping_rates`) ومسودة `0005c` بتتحقق من الوجود في `rates`
بس. قفل محافظة من اللوحة = هي تفضل في القائمة **وتقبل طلبات**.

**(ج) `shipping_default_piastres` دلالته متناقضة.** `computeShippingPiastres` بيرجع
للافتراضي لو المحافظة مش في `rates`، بينما المسودة بترفض الطلب أصلاً.

**(د) `notify_email` فاضي.** مفتاح **غير سرّي**، بس قيمته `""` — لو الإشعار اعتمد عليه
من غير فحص صريح، الطلبات تنجح بصمت من غير ما حد يعرف.

### 0.4 التوجيهات المعتمدة — الجولة الأولى

| # | التوجيه | الأثر |
|---|---|---|
| **ت١** | توكن تليجرام و chat id **لازم** ينتقلوا لمتغيرات بيئة سيرفر فقط. ممنوع أسرار في `settings`. | §7.3، §9.2، §9.4، اختبار ٣٦ |
| **ت٢** | `notify_email` يقدر يفضل إعداد لوحة **غير سرّي**، بس فاضي حالياً والإشعار لازم يتعامل مع ده صريح. | §7.4، §7.5، اختبار ٢٢ |
| **ت٣** | المحافظات المقفولة تُفرض في **خيارات المتجر** و**معاملة الطلب الموثوقة**. | §2.4، §3.3، §8، اختبار ١٦ + ١٦ب |
| **ت٤** | **ممنوع تنفيذ** `0005a/0005b/0005c` كما هي — مراجعة جديدة واستبدال. | §2.1 |
| **ت٥** | كود خطأ **منفصل** للتزامن. ممنوع تعيين التسابق على `ITEM_UNAVAILABLE`. | §1.3، §3.3، §4.4، اختبار ٧ |
| **ت٦** | دلالة `shipping_default_piastres` موحّدة بين العرض وسلطة الداتابيز. | §2.4، §3.3، اختبار ١٨ |
| **ت٧** | **ممنوع** `orders_read_for_definer using (true)` ولا أي `select` عام على `orders` لدور الكتابة. | §2.3 |

### 0.5 التبسيطات المعتمدة — الجولة التانية

| # | التبسيط | الأثر |
|---|---|---|
| **ب١** | **سطح الداتابيز = دالتين بس:** `zell_create_order` و`zell_get_order_receipt`. الدالة الأولى بتعمل التحقق وعدّ نافذة الموبايل والـidempotency والتسعير والشحن والإدخال وإسقاط الإيصال **جواها**. ممنوع دوال replay/count عامة إلا بقيد تقني محدّد وبمراجعة مستقلة. | §2؛ ٣ دوال اتشالت، وكمان مولّد الرقم اتدمج |
| **ب٢** | ممنوع الاعتماد على تحديد معدّل في الذاكرة أو لكل IP على Vercel Hobby. الحد الموثوق الوحيد = **نافذة الموبايل جوه المعاملة**. حدود IP/WAF تشغيلية وتُضاف منفصلة. مفيش HMAC fingerprint. | §5 |
| **ب٣** | رمز الإيصال = **سر عشوائي، والداتابيز تخزّن الـhash بس**. | §6.1 |
| **ب٤** | الاختبار على **Production** بطلبات اختبار واضحة التعريف، تتحذف يدوي قبل الإطلاق. | §10 |
| **ب٥** | مسوّدات Retool تُنقل لـ`docs/legacy/` برأس تحذير بارز. **التاريخ ما يتحذفش.** | §8 |
| **ب٦** | **الـreplay ممنوع يبعت إشعار تاني.** | §4.3، §7.2، اختبار ٢٣ |
| **ب٧** | ترتيب نقل تليجرام: (١) بطّل القراءة من `settings` → (٢) متغيرات بيئة → (٣) تحقّق → (٤) **migration تنظيف منفصلة**. | §7.3، §9.2، §9.4 |

### 0.6 التعديل الأمني المعتمد — الجولة التالتة (ب٨)

**الاعتراض:** الجولة التانية كانت بتحط رمز الإيصال في مسار الـURL. Vercel بتسجّل
**مسارات** الطلبات في access logs، فالسر الخام كان هيتسجّل. صلاحية ٧ أيام **ما بتشيلش**
التعرّض ده: أي موظف أو أداة logging تقدر تستخدم الرمز جوه النافذة.

**القرار (ب٨) — مُقرّ:** **ممنوع أي سر في أي URL.** الوصول للإيصال عن طريق **كوكي
`HttpOnly` مقيّد بمسار الطلب**.

### 0.7 القرار النهائي — الجولة الرابعة (ب٩): الكوكي في نفس الرد

**ق٨ = أيوه.** راوت تبادل الجلسة المنفصل **اتلغى بالكامل**. `POST /api/orders` **هو**
اللي بيضبط كوكي الإيصال في رده مباشرةً.

| # | القاعدة |
|---|---|
| ١ | الرمز الخام يتولّد **في السيرفر** |
| ٢ | **الهاش بس** (`SHA-256`) يتبعت لـ`zell_create_order` |
| ٣ | **الهاش بس** يتخزّن في الداتابيز |
| ٤ | **الرمز الخام عمره ما يترجع في JSON** |
| ٥ | الكوكي لكل طلب بيتضبط **على نفس رد الـAPI الناجح** |
| ٦ | الـJSON فيه بيانات طلب آمنة و`replayed` وبس |
| ٧ | العميل بيعمل `router.replace('/order/' + orderNumber)` |
| ٨ | الـreplay بيدوّر الرمز/الهاش و**بيكتب فوق نفس الكوكي المقيّد في نفس الرد** |
| ٩ | **اتشال:** `/api/receipt-session`، حقل الرمز الخام في الرد، عقد التبادل، وكود `RECEIPT_TOKEN_INVALID` |
| ١٠ | صفحة الإيصال تقرا الكوكي المقيّد سيرفر-سايد، تهشّمه، وتنادي `zell_get_order_receipt` |
| ١١ | كوكي ناقص أو غلط أو منتهي → **نفس حالة «الإيصال غير متاح» العامة**، بدون تأكيد وجود الطلب أو عدمه |

**المكسب على الخطوتين:** السر **عمره ما يلمس JavaScript** ولا جسم رد، مفيش راوت تاني،
مفيش تخزين على العميل، ومسار فشل كامل اتشال.

---

## 1. العقود (TypeScript)

مكانها: `packages/core/src/orders.ts` + تصدير من `packages/core/src/index.ts`.

### 1.1 الطلب

    /** عنصر سلة — أرقام فقط. مفيش سعر ولا إجمالي جاي من العميل، إطلاقاً. */
    export type OrderRequestItem = {
      productId: number   // صحيح موجب
      lengthCm: number    // صحيح موجب؛ التحقق من min/step/max في الداتابيز
    }

    export type OrderRequestBody = {
      items: OrderRequestItem[]   // 1..20
      customerName: string        // بعد trim >= 3
      customerPhone: string       // بعد normalizePhone: ^01[0125][0-9]{8}$
      governorate: string         // مفتاح في shipping_rates وغير مقفول
      address: string             // بعد trim >= 8
      notes?: string              // اختياري، <= 500 حرف، فاضي => null
    }

`Idempotency-Key` **هيدر** مش حقل في الـbody.

### 1.2 الرد — صفر أسرار

    export type OrderSuccess = {
      ok: true
      order: {
        orderNumber: string
        subtotalPiastres: number
        shippingPiastres: number
        totalPiastres: number
        replayed: boolean
      }
    }

    export type OrderFailure = {
      ok: false
      code: OrderErrorCode
      message: string            // عربي ثابت مشتق من الكود — مش من الاستثناء
      retryable: boolean
    }

    export type OrderResponse = OrderSuccess | OrderFailure

**مع الرد الناجح، وفي نفس الاستجابة:**

    Set-Cookie: zell_rcpt_<ORDER_NUMBER>=<RAW_TOKEN>; HttpOnly; Secure;
                SameSite=Lax; Path=/order/<ORDER_NUMBER>; Max-Age=604800

**اللي اتشال من العقد (ب٩):** `receiptToken` · `receiptPath` · `itemCount` ·
`ReceiptSessionRequest` · `RECEIPT_TOKEN_INVALID`.

`itemCount` مش محتاج: صفحة الإيصال بتعرض الأصناف نفسها من
`zell_get_order_receipt`، وصفحة الدفع عارفة سلتها.

### 1.3 جدول الأكواد ← HTTP ← الرسالة العربية الثابتة

الرسالة **دايماً** من الجدول ده. مفيش `err.message` بيوصل للعميل أبداً.

| الكود | HTTP | الرسالة العربية | retryable |
|---|---|---|---|
| `ORDERS_DISABLED` | 503 | تأكيد الطلب مش متاح دلوقتي. كلّمنا على واتساب. | لا |
| `BAD_CONTENT_TYPE` | 415 | طلب غير صحيح. | لا |
| `BODY_TOO_LARGE` | 413 | البيانات المرسلة كبيرة جداً. | لا |
| `BAD_JSON` | 400 | طلب غير صحيح. | لا |
| `IDEMPOTENCY_REQUIRED` | 400 | طلب غير صحيح. | لا |
| `IDEMPOTENCY_MISMATCH` | 409 | البيانات اتغيّرت. حدّث الصفحة وجرّب تاني. | لا |
| `CART_EMPTY` | 400 | السلة فاضية. | لا |
| `CART_TOO_LARGE` | 400 | عدد الأصناف كبير جداً في طلب واحد. | لا |
| `CART_INVALID` | 400 | في صنف غير صحيح في السلة. حدّث الصفحة. | لا |
| `INVALID_NAME` | 400 | من فضلك اكتب الاسم بالكامل. | لا |
| `INVALID_PHONE` | 400 | رقم الموبايل غير صحيح. | لا |
| `INVALID_ADDRESS` | 400 | من فضلك اكتب عنوان التوصيل بالتفصيل. | لا |
| `NOTES_TOO_LONG` | 400 | الملاحظات طويلة جداً. | لا |
| `GOVERNORATE_NOT_SERVED` | 400 | المحافظة دي مش ضمن مناطق الشحن المتاحة. | لا |
| `ITEM_UNAVAILABLE` | 409 | في صنف في السلة مش متاح أو الطول مش مسموح. حدّث الصفحة. | لا |
| **`CONCURRENT_SUBMIT`** | **409** | **الطلب بيتسجّل بالفعل. استنى لحظة.** | **أيوه** |
| `PHONE_DAILY_LIMIT` | 429 | وصلت لأقصى عدد طلبات لنفس الرقم في اليوم. كلّمنا على واتساب. | لا |
| `SETTINGS_MISSING` | 503 | في مشكلة مؤقتة في إعدادات الشحن. كلّمنا على واتساب. | أيوه |
| `ORDER_NUMBER_EXHAUSTED` | 503 | مشكلة مؤقتة. جرّب تاني بعد لحظة. | أيوه |
| `INTERNAL` | 500 | حصلت مشكلة غير متوقّعة. كلّمنا على واتساب. | أيوه |

**`CONCURRENT_SUBMIT` كود مستقل إلزامي (ت٥).** حالة التسابق ممنوع تتحوّل لرسالة «صنف
غير متاح» — دي رسالة بتخلّي العميل يعدّل سلة سليمة ويعمل طلب تاني.

`RATE_LIMITED` **اتشال** من المرحلة الأولى (ب٢). الكود محفوظ في النوع لما يتضاف WAF.
`RECEIPT_TOKEN_INVALID` **اتشال خالص** (ب٩) — مفيش تبادل يفشل.

> **السعر القديم:** مفيش كود `PRICE_CHANGED`. **ما نقبلش أي رقم من العميل إطلاقاً**،
> والإجمالي الحقيقي يتعرض في الإيصال بوضوح.

---

## 2. طبقة الداتابيز — أربعة أعمدة ودالتين

### 2.1 المسوّدات القديمة: مرفوضة للتنفيذ (ت٤)

`0005a` و`0005b` و`0005c` **مش بتتنفّذ، لا كما هي ولا بتعديل جزئي.** الأسباب:

1. `0005c` فيها `orders_read_for_definer using (true)` — مرفوضة (ت٧)، والرفض بيكسر
   تصميم الـreplay والحد اليومي المبني عليها.
2. فرجة المحافظات المقفولة (ت٣).
3. تناقض `shipping_default_piastres` (ت٦).
4. بتعيّن التسابق على `ZELL_ITEM_UNAVAILABLE` (ت٥).
5. مكتوبة وقت ما المنفّذ كان Retool (`grant execute ... to postgres`).
6. بتوزّع المنطق على ٣ ملفات ودور وسياسات RLS — أتقل من اللازم لمتجر بصفر طلبات (ب١).
7. مالهاش أي أعمدة للإيصال (ب٣ + ب٨ + ب٩).

**المعرفة المستخرجة منها تُعاد استخدامها** لأنها سليمة ومتحقَّق منها:
- الضمانة الحقيقية لرقم الطلب هي القيد الفريد + إعادة المحاولة، **مش فحص الوجود**.
- الهاش يُحسب في الباك إند (`pg_catalog.sha256` غير موثوق هنا، وpgcrypto في schema
  `extensions`).
- **تحديد المعدّل ممنوع في الداتابيز**: أي `raise exception` بيرجّع العدّاد. (عدّ
  **الطلبات المكتملة** مختلف — ده قراءة مش عدّاد، فهو سليم.)
- تحقق آمن من شكل الـJSON **قبل** أي `cast`.
- `search_path = ''` + `pg_catalog.` صريح على كل دالة مدمجة.
- `revoke all from public, anon, authenticated` **قبل** أي `grant`.

**الإجراء:** مجموعة جديدة من **ملفين بس**، تُكتب من الصفر بعد دمج الوثيقة دي:

| الملف | المحتوى |
|---|---|
| `backend/db/migrations/0006a_order_columns.sql` | ٤ أعمدة + قيود + فهرس فريد جزئي |
| `backend/db/migrations/0006b_order_functions.sql` | دور `zell_order_writer` + `zell_create_order` + `zell_get_order_receipt` |

ولاحقاً، **منفصلة** وبعد التحقق من الإشعار (ب٧):

| `backend/db/migrations/0007_cleanup_notify_secrets.sql` | حذف صفّي `telegram_bot_token` و`telegram_chat_id` من `settings` |

### 2.2 `0006a` — الأعمدة

    alter table orders add column idempotency_key    text;
    alter table orders add column request_hash       text;
    alter table orders add column receipt_token_hash text;
    alter table orders add column receipt_expires_at timestamptz;

    check (idempotency_key is null
           or length(btrim(idempotency_key)) between 16 and 128)
    check (request_hash is null       or request_hash ~ '^[0-9a-f]{64}$')
    check (receipt_token_hash is null or receipt_token_hash ~ '^[0-9a-f]{64}$')

    -- نقطة الذرّية الوحيدة
    create unique index orders_idempotency_key_uidx
      on orders (idempotency_key) where idempotency_key is not null;

- كل الأعمدة nullable → الطلبات اليدوية من اللوحة تفضل صالحة، والتراجع آمن.
- **مفيش فهرس على `receipt_token_hash`**: البحث بيبدأ من `order_number` اللي عليه
  `orders_order_number_key` أصلاً، والهاش بيتقارن بعدها على صف واحد.
- **شرط حرج:** predicate الفهرس (`where idempotency_key is not null`) لازم يطابق
  **حرفياً** جملة `on conflict ... where ...` جوه `zell_create_order`.

### 2.3 `0006b` — الدور: صفر صلاحيات على الجداول (ت٧ + ب١)

`zell_order_writer`: `nologin nobypassrls`، وصلاحياته **بالكامل**:

| المورد | الصلاحية |
|---|---|
| `zell_create_order` | `execute` |
| `zell_get_order_receipt` | `execute` |
| **كل الجداول** | **ولا حاجة — لا `select`، لا `insert`، لا `update`، لا `delete`** |

ده **أضيق وأبسط** في نفس الوقت:
- سؤال «`using (true)` أو لأ؟» **اتلغى من أصله** — الدور مالوش `select` على `orders`.
- **مفيش ولا سياسة RLS واحدة محتاجة تتكتب** في المجموعة دي.
- السطح القابل للاستدعاء = **دالتين موقّعتين بأنواع ثابتة**، مش جداول.

> **المقايضة مكتوبة صريح:** دالة `security definer` مملوكة لمالك الجدول هي نقطة ترقية
> صلاحيات. مقبولة **فقط** بالشروط دي، وكلها إلزامية في المراجعة:
> - `set search_path = ''` و`pg_catalog.` صريح على كل دالة مدمجة.
> - **مفيش `execute` ديناميكي** ولا `format()` ولا أي SQL مبني من نص.
> - كل المدخلات **قيم بسيطة** — **مفيش أي `where` أو `order by` أو `limit` قابل
>   للتمرير من المستدعي**.
> - `revoke all ... from public, anon, authenticated` **قبل** أي منح.
> - الجسم ثابت والمخرج إسقاط محدّد مسبقاً.

### 2.4 دلالة الشحن الموحّدة (ت٣ + ت٦)

القاعدة الواحدة، مطبّقة في الداتابيز وفي `packages/core` بنفس الترتيب:

1. المحافظة **لازم** تكون مفتاح في `shipping_rates`.
2. المحافظة **لازم** تكون **مش** في `shipping_disabled_governorates`.
3. الشحن = `shipping_rates -> governorate`.
4. لو `free_shipping_threshold_piastres > 0` والإجمالي الفرعي ≥ العتبة → الشحن = ٠.
5. `shipping_default_piastres` **مش جزء من تسعير الطلب**. دوره الوحيد: القيمة المقترحة
   في اللوحة لما المالك يضيف محافظة جديدة.

نتيجة ده: فرع الرجوع للافتراضي يُشال من `computeShippingPiastres`، والقائمة المنسدلة
تبقى «مفاتيح `rates` ناقص `disabled`». البديل **مرفوض** لأنه بيخلّي محافظة محذوفة من
`rates` تقبل طلبات بسعر افتراضي من غير قرار صريح.

### 2.5 مولّد رقم الطلب: اتدمج، وفحص الوجود اتشال (ب١)

مفيش دالة `generate_order_number` منفصلة. التوليد سطرين جوه `zell_create_order`:
أبجدية ٣٢ حرف من غير `O/0/I/1`، ٦ حروف، العشوائية من `gen_random_uuid()` (مدمج في
PG13+).

**فحص الوجود قبل الإدخال اتشال خالص.** المسودة القديمة كانت بتعمله وبتعترف إنه «مش
ضمانة». الضمانة الحقيقية هي `orders_order_number_key` + إعادة المحاولة على
`unique_violation`.

### 2.6 نقطة أمانة لازم تتكرر في الوثائق

المتجر بيستخدم `SUPABASE_SERVICE_ROLE_KEY`، و`service_role` **بيتخطى RLS بالكامل**.
أي دور وأي سياسة **مش** حد أمان فعّال اليوم؛ الحد الحقيقي هو كود التطبيق. قيمة
`zell_order_writer` إنه الشرط المسبق لإلغاء `service_role`: وقتها الاستبدال = متغير
بيئة واحد من غير أي تعديل كود، لأن المتجر **مش** بيلمس أي جدول في مسار الطلب.

---

## 3. `zell_create_order` — كل حاجة جوه معاملة واحدة

### 3.1 القاعدة

**استدعاء واحد = transaction واحد.** مفيش أي خطوتين على الداتابيز قبل الـcommit، فمستحيل
يحصل «طلب موجود من غير أصناف».

### 3.2 التوقيع

    zell_create_order(
      p_items              jsonb,
      p_customer_name      text,
      p_customer_phone     text,   -- مطبّع في الباك إند
      p_governorate        text,
      p_address            text,
      p_notes              text,
      p_idempotency_key    text,
      p_request_hash       text,   -- SHA-256 hex، محسوب في الباك إند
      p_receipt_token_hash text    -- SHA-256 hex لسر الإيصال، محسوب في الباك إند
    ) returns jsonb

### 3.3 التسلسل

1. تحقق المفتاح (١٦–١٢٨ بعد `btrim`) والهاشين (٦٤ حرف hex صغير لكل واحد).
2. تحقق نصّي: الاسم ≥ ٣، الموبايل `^01[0125][0-9]{8}$`، العنوان ≥ ٨، الملاحظات ≤ ٥٠٠.
3. تحقق **آمن** من شكل السلة **قبل** أي `cast`: `jsonb_typeof = 'array'`، الطول ١..٢٠،
   كل عنصر `object` فيه `productId` و`lengthCm` مطابقين لregex أرقام موجبة.
4. إعدادات الشحن: `shipping_rates` (object)، `free_shipping_threshold_piastres`
   (number)، `shipping_disabled_governorates` (array). ناقص أو نوع غلط →
   `ZELL_SETTINGS_MISSING`. **`shipping_default_piastres` مش مقروء** (ت٦).
5. **المحافظة (ت٣):** في `rates` **و** مش في `disabled` → غير كده
   `ZELL_GOVERNORATE_NOT_SERVED`.
6. **نافذة الموبايل (ب٢):** `count(*) from orders where customer_phone =
   p_customer_phone and created_at >= now() - interval '24 hours'` ≥ ٥ →
   `ZELL_PHONE_DAILY_LIMIT`. قراءة جوه الدالة، مفيش دالة count عامة (ب١). بتعدّ
   الطلبات **المكتملة**، فالتراجع ما يأثّرش عليها.
7. حلقة ٥ محاولات، كل محاولة جوه `begin ... exception when unique_violation`، وجواها
   **عبارة CTE واحدة**:
   - `req` — فك السلة.
   - `priced` — `join products` بشرط `is_active` و`length_cm between min and max`
     و`((length_cm - min) % step) = 0`، و`line_total = round(price_per_meter *
     length_cm / 100.0)`.
   - `totals` — المجموع و`ok_count`.
   - `ship` — السعر من `rates`، والشحن ٠ لو العتبة اتحققت.
   - `new_order` — `insert into orders (... , idempotency_key, request_hash,
     receipt_token_hash, receipt_expires_at) select <رقم مولّد>, ... , now() + interval
     '7 days' where ok_count > 0 and ok_count = (select count(*) from req)`
     + `on conflict (idempotency_key) where idempotency_key is not null do nothing`
     + `returning`.
     - **الشرط `ok_count = count(req)` هو قلب الذرّية:** أي صنف مرفوض = الطلب مايتعملش
       أصلاً. مفيش طلب ناقص.
   - `items_ins` — `insert into order_items ... from new_order cross join priced`.
   - `select` نهائي؛ نجاح → `exit`.
   - `unique_violation`: `get stacked diagnostics` — لو القيد
     `orders_order_number_key` → محاولة جديدة برقم جديد؛ أي قيد تاني → `raise` كما هو؛
     استنفاد المحاولات → `ZELL_ORDER_NUMBER_EXHAUSTED`.
8. **لو صفر صفوف** — تمييز تلاتي إلزامي (كله جوه نفس الدالة، مفيش helper):
   - في صف بنفس `idempotency_key` **و** `request_hash` مطابق → **replay** (§4.3).
   - في صف **و** الهاش مختلف → `ZELL_IDEMPOTENCY_MISMATCH`.
   - مفيش صف:
     - لو الإدخال اصطدم فعلاً → **`ZELL_CONCURRENT`** (ت٥).
     - غير كده → `ZELL_ITEM_UNAVAILABLE`.
9. بترجّع: رقم الطلب، الإجماليات، `replayed`.

### 3.4 ملاحظات ذرّية

- `ON CONFLICT DO NOTHING` بيستنى الـtransaction المتعارضة تخلص قبل ما يتجاهل، فالقراءة
  اللي بعده بتشوف الصف المعتمد. ده اللي بيحوّل التسابق لـreplay نضيف.
- `round()` مرة واحدة لكل سطر في `priced` ثم الجمع — **لازم** يطابق ترتيب
  `computeSubtotalPiastres` حرفياً، وإلا فرق قرش بين المعروض والمحسوب.
- كل الأرقام قروش صحيحة (`integer`). مفيش `numeric` ولا عشري في أي مكان.
- `p_receipt_token_hash` **هاش بس** — السر الخام **ما بيدخلش الداتابيز إطلاقاً**، فما
  بيظهرش في `log_statement` ولا في `pg_stat_statements`.

---

## 4. الـidempotency

### 4.1 المفتاح (العميل)

- عند أول `submit`: `crypto.randomUUID()` (٣٦ حرف، جوه نطاق ١٦–١٢٨).
- يُخزّن في `useRef` **و** `sessionStorage['zell-order-intent']` → تحديث الصفحة أو
  إعادة المحاولة بيستخدموا نفس المفتاح.
  **ملاحظة:** المفتاح **مش سر** — هو معرّف نيّة. السر الوحيد في المسار ده هو رمز
  الإيصال، وهو **عمره ما يوصل للعميل كقيمة قابلة للقراءة** (ب٩).
- يتجدّد **فقط** بعد نجاح، أو بعد خطأ `retryable: false` والمستخدم عدّل البيانات.
- إعادة المحاولة بعد خطأ شبكة أو 5xx = **نفس المفتاح**.

### 4.2 الهاش (السيرفر فقط)

العميل **ما بيبعتش هاش**. السيرفر بيحسبه بعد التطبيع:

1. `trim` للاسم والعنوان؛ الملاحظات `trim` ثم فاضي → `null`.
2. `normalizePhone(raw)` من `packages/core/src/validation.ts`.
3. `items` مرتّبة تصاعدياً بـ`productId` ثم `lengthCm`.
4. كائن قانوني بترتيب مفاتيح ثابت → `JSON.stringify` → `TextEncoder` →
   `crypto.subtle.digest('SHA-256')` → hex صغير.

التطبيع قبل الهاش **ضروري**: لولاه «احمد » و«احمد» يبقوا طلبين مختلفين بنفس المفتاح =
`IDEMPOTENCY_MISMATCH` كاذب.

**`receipt_token_hash` مش جزء من `request_hash`** — الرمز بيتولّد جديد كل محاولة، فلو
داخل في الهاش كانت كل إعادة محاولة بتبقى `MISMATCH`.

### 4.3 سلوك السيرفر

| الحالة | النتيجة |
|---|---|
| مفتاح جديد، سلة سليمة | 201 + `replayed: false` + `Set-Cookie` جديد + **إشعار يتبعت** |
| نفس المفتاح + نفس الطلب | 200 + `replayed: true` + نفس رقم الطلب والأرقام + `Set-Cookie` **جديد بيكتب فوق القديم** + **مفيش إشعار** (ب٦) |
| نفس المفتاح + طلب مختلف | 409 `IDEMPOTENCY_MISMATCH` — **مفيش `Set-Cookie`** |
| مفتاح ناقص أو طوله غلط | 400 `IDEMPOTENCY_REQUIRED` — **مفيش `Set-Cookie`** |
| تسابق والفايز رجع للخلف | 409 `CONCURRENT_SUBMIT` — **مفيش `Set-Cookie`** |

**قاعدة:** `Set-Cookie` بيتضبط **بس** مع رد ناجح (201 أو 200 replay). أي رد خطأ
**ممنوع** يلمس الكوكي — لا يضبطه ولا يمسحه.

**رمز الإيصال عند الـreplay — تدوير في نفس الرد.** الداتابيز مخزّنة الـhash بس، فالسر
الأصلي **مش قابل للاسترجاع**. وفي إعادة محاولة حقيقية بعد فشل شبكة، العميل عمره ما
استلم كوكي. فالـreplay:

1. بيولّد رمز جديد في السيرفر.
2. بيحدّث `receipt_token_hash` و`receipt_expires_at` جوه الدالة.
3. بيضبط **نفس اسم الكوكي ونفس الـ`Path`** في نفس الرد → القديم بيتكتب فوقه تلقائياً.

- **المبرّر:** تقديم نفس `idempotency_key` **مع** نفس `request_hash` بالبايت هو إثبات
  إنك الطالب الأصلي. الرمز القديم **يبطل** — فده **تدوير**، مش إضافة.
- التحديث بيحصل **جوه** الدالة المملوكة لمالك الجدول بس. `zell_order_writer` لسه
  **مالوش** `update` على `orders`.
- `updated_at` يُكتب صريح (مفيش triggers).
- **البديل المرفوض:** replay يرجّع رقم الطلب بدون كوكي — كان هيسيب أشهر حالة إعادة
  محاولة (فشل شبكة بعد الالتزام) من غير إيصال خالص.

### 4.4 التزامن

- **نفس المفتاح، طلبين في نفس اللحظة:** الفهرس الفريد الجزئي هو نقطة الحكم. الخسران
  بياخد صفر صفوف، يستنى، يلاقي صف الفايز، يرجّع replay. **طلب واحد بس بيتكوّن، وإشعار
  واحد بس بيتبعت.**
- **الحالة النادرة** (الفايز رجع للخلف) → `CONCURRENT_SUBMIT`، مش `ITEM_UNAVAILABLE`.
- **منع الضغط المزدوج في الواجهة:** `submitting` state → الزر `disabled` + `aria-busy`،
  و`if (submitting) return` في أول `onSubmit` (حرس ضد الإرسال بـEnter)،
  و`AbortController` واحد.

---

## 5. تحديد المعدّل (ب٢)

### 5.1 القرار

**مفيش تحديد معدّل في ذاكرة التطبيق ولا لكل IP في كود المرحلة الأولى.** على
Vercel Hobby بدون Redis/KV، كل نسخة دالة منفصلة: العدّاد في الذاكرة بيتصفّر مع كل نسخة
ومش مشترك — فهو بيدّي **إحساس** أمان مش أمان. اتشال بالكامل، ومعاه `lib/rateLimit.ts`
من قايمة الملفات. ومفيش HMAC fingerprint ولا بصمة جهاز.

### 5.2 اللي موجود فعلاً

| الطبقة | المكان | الحد | طبيعتها |
|---|---|---|---|
| **شكل الطلب** | الراوت، قبل أي قراءة | `Content-Type: application/json` فقط؛ الـbody ≤ **١٦ ك.ب**؛ الأصناف ≤ ٢٠؛ الملاحظات ≤ ٥٠٠ | قاطعة ورخيصة |
| **نافذة الموبايل** | جوه `zell_create_order` | **٥ طلبات لكل رقم مطبّع / ٢٤ ساعة متجددة** | **قاطعة وموثوقة — قاعدة العمل** |
| **IP / WAF** | إعداد Vercel، **مش كود** | يُضبط تشغيلياً | **مؤجّلة** — تُضاف منفصلة |

سطح الـHTTP كله راوت واحد (ب٩)، فمفيش أي نقطة تانية محتاجة حد خاص.

### 5.3 المخاطرة المتبقية — مكتوبة صريح

`idempotency` بيمنع **تكرار إعادة المحاولة**، و**مش** بيمنع الـ**spam**. نافذة الموبايل
بتقيّد المهاجم اللي بيستخدم رقم واحد، لكن مهاجم بأرقام كتير مختلفة **مش** متوقّف من
التطبيق في المرحلة الأولى.

التخفيف تشغيلي مش برمجي:
- قاعدة WAF/Firewall على `/api/orders` عند الحاجة (إعداد، مش نشر).
- الكشف: حجم رسايل تليجرام + قايمة الطلبات في اللوحة.
- الرد الفوري = شيل `ORDERS_ENABLED` (§9.3) — ثواني، وبدون لمس الداتابيز.

مقبول **لأن** المتجر بصفر طلبات والحجم المتوقّع صغير. يُعاد النظر قبل أي حملة إعلانية.

---

## 6. الوصول للإيصال — كوكي `HttpOnly` في نفس رد الـAPI (ب٨ + ب٩)

### 6.1 السر: عشوائي، والداتابيز فيها الـhash بس

| الخطوة | المكان |
|---|---|
| توليد ٣٢ بايت عشوائية → `base64url` (٤٣ حرف) | **السيرفر** |
| `SHA-256` hex للسر | **السيرفر** |
| إرسال **الهاش بس** لـ`zell_create_order` | RPC |
| تخزين **الهاش بس** + `receipt_expires_at = now() + 7 days` | الداتابيز |
| إرسال **السر الخام** في `Set-Cookie` بس | هيدر الرد |

- **السر الخام عمره ما يدخل الداتابيز** — التوليد والهاش في السيرفر. لو الداتابيز
  ولّدته كان هيظهر في `log_statement` وفي `pg_stat_statements`.
- **السر الخام عمره ما يترجع في JSON** (ب٩) — فما بيلمسش JavaScript ولا أي أداة بتلتقط
  ردود `fetch`.
- **مفيش سر مشترك ولا HMAC** — تسريب سر مشترك كان هيسمح بتوليد رمز لأي رقم طلب؛
  دلوقتي تسريب صف واحد بيكشف hash مش رمز.
- **مفيش متغير بيئة جديد** للإيصال.

### 6.2 ليه الكوكي وليه مش الـURL ولا الـJSON

| قناة التعرّض | رمز في المسار (مرفوض) | رمز في JSON (مرفوض) | كوكي `HttpOnly` في الرد (معتمد) |
|---|---|---|---|
| Vercel access logs | **بتسجّل المسار** → السر مسجّل | ما بتسجّلش الأجسام | المسار **مفيهوش سر** |
| `Referer` لطرف تالت | بيتسرّب | لأ | الكوكي ما بيتبعتش في `Referer` |
| تاريخ المتصفح / الإكمال التلقائي | السر محفوظ | لأ | لأ |
| مشاركة الرابط بالغلط | بتشارك الوصول | لأ | بتشارك رقم طلب بس |
| ذاكرة JavaScript | لأ | **السر مقروء من أي سكربت** | **`HttpOnly` — ولا كودنا يشوفه** |
| أداة تتبّع أخطاء بتلتقط ردود `fetch` | لأ | **بتشوف السر** | لأ |
| إضافة متصفح | ممكن | **ممكن** | لأ |

`Max-Age` ٧ أيام **ما كانتش** بتحل مشكلة المسار: أي موظف أو أداة logging تقدر تستخدم
السر جوه النافذة. والـJSON كان بيرجّع نسخة مصغّرة من نفس المشكلة. **الكوكي في نفس الرد
بيقفل القنوات السبعة.**

### 6.3 ضبط الكوكي — خطوة واحدة

`POST /api/orders` عند النجاح (201 أو 200 replay):

1. يولّد الرمز ويهشّمه (§6.1).
2. ينادي `zell_create_order` بالهاش.
3. يبني الرد: JSON فيه `order` بس (§1.2) **زائد** هيدر:

       Set-Cookie: zell_rcpt_<ORDER_NUMBER>=<RAW_TOKEN>; HttpOnly; Secure;
                   SameSite=Lax; Path=/order/<ORDER_NUMBER>; Max-Age=604800

4. العميل يعمل `router.replace('/order/' + orderNumber)` وينضّف السلة.

**مفيش راوت تبادل، مفيش عقد تاني، مفيش مسار فشل تاني.**

**فخ تنفيذي لازم يتحاشى:** استدعاء `fetch` في `CheckoutForm` **ممنوع** يبقى
`credentials: 'omit'` — وقتها المتصفح بيتجاهل `Set-Cookie` والكوكي ما بيتخزّنش أبداً،
والنتيجة إيصال بيرجّع «غير متاح» من غير أي خطأ ظاهر. الافتراضي (`same-origin`) صح،
والمطلوب إننا ما نكتبش `omit` بالغلط. **فيه اختبار مخصّص لده (٤٤).**

### 6.4 مواصفات الكوكي

| السمة | القيمة | السبب |
|---|---|---|
| الاسم | `zell_rcpt_FLM_ABC234` (رقم الطلب و`-` بقت `_`) | **اسم لكل طلب** → أكتر من إيصال بالتوازي |
| القيمة | الرمز الخام (٤٣ حرف base64url) | — |
| `HttpOnly` | أيوه | JavaScript مش بيشوفه — ولا حتى كودنا |
| `Secure` | أيوه | HTTPS بس |
| `SameSite` | `Lax` | بيوصل مع التنقّل من نفس الموقع، ومش بيتبعت cross-site |
| `Max-Age` | `604800` (٧ أيام) | ق٣ |
| `Path` | `/order/FLM-ABC234` | الكوكي **مش بيتبعت** لأي مسار تاني — ولا لـ`/api/orders` ولا للصفحة الرئيسية |
| `Domain` | **مش مضبوط** | host-only — ما يتسربش لأي subdomain |

**ليه الاسم من رقم الطلب مش من hash:** رقم الطلب **مش سر** (موجود في المسار أصلاً،
والوصول محتاج الكوكي). فالهاش كان هيضيف خطوة حساب في كل قراءة من غير أي مكسب أمني.
الاسم المشتق مباشرة **قابل للحساب من `params.orderNumber`** بدون أي حالة إضافية.

**ملاحظات تقنية متحقَّق منها:**
- **الكوكي هتوصل للصفحة؟ أيوه.** `Path=/order/FLM-ABC234` بيطابق طلب الصفحة نفسه،
  وبيطابق كمان طلب الـRSC اللي `router.replace` بيعمله (`/order/FLM-ABC234?_rsc=...`)
  — الـquery مش جزء من مطابقة الـ`Path`. فالتنقّل من غير إعادة تحميل كامل شغّال.
- **الكوكي مش بتتفورورد لـSupabase.** استدعاء `zell_get_order_receipt` هو `fetch` من
  السيرفر لـSupabase، وما بياخدش كوكيز المتصفح — ولا المفروض ياخدها. Server Component
  بيقرا الكوكي بـ`cookies()`، يهشّمه، **ويبعت الهاش بس**.
- `Path` matching في RFC 6265 على حدود المقاطع، وأرقام الطلب كلها ٦ حروف بطول ثابت،
  فمفيش تصادم بادئات بين طلبين.
- **`__Host-` مش مستخدمة** عن قصد: البادئة دي بتفرض `Path=/`، وده بيلغي أهم خاصية
  عندنا. `__Secure-` متوافقة وتقدر تتضاف كتقوية اختيارية، بس بتعقّد التطوير المحلي
  على `http://`.
- Safari ITP بتقصّر الكوكيز **المكتوبة من JavaScript** على ٧ أيام؛ كوكي `HttpOnly`
  مضبوط من السيرفر **مش** مشمول بالقيد ده، فـ٧ أيام شغّالة.
- حدود المتصفح للكوكيز لكل نطاق (حوالي ١٨٠) معناها إن عميل بمئات الطلبات في ٧ أيام
  ممكن يفقد أقدم كوكي. مش حالة واقعية للمتجر، ومذكورة للاكتمال (ح٦).

### 6.5 صفحة الإيصال

`apps/storefront/app/order/[orderNumber]/page.tsx`

1. `export const dynamic = 'force-dynamic'` + `Cache-Control: no-store` — المحتوى
   محجوب بكوكي، فممنوع أي cache.
2. `robots: index: false, follow: false`.
3. تحقق شكل `params.orderNumber` بـ`isValidOrderNumber`.
4. `cookies().get('zell_rcpt_' + safe(orderNumber))`.
5. هاش القيمة **سيرفر-سايد** → `zell_get_order_receipt(orderNumber, tokenHash)`.
6. رجع `null` → حالة «غير متاح» (§6.7).
7. `Referrer-Policy: no-referrer` لسه مضبوط — بقى طبقة زيادة مش طبقة حاملة.

**مفيش `select` على `orders` من المتجر** — لا بـ`service_role` ولا بغيره.

### 6.6 الإسقاط — التقنيع في الداتابيز

| يُرجَع | ما يُرجَعش |
|---|---|
| رقم الطلب | **العنوان — لا كامل ولا جزء منه** (ق٦) |
| الإجماليات التلاتة | **الموبايل الكامل** — آخر ٤ أرقام بس |
| `created_at` | `internal_notes` |
| المحافظة | `notify_error` / `notified_at` |
| الاسم الأول | الحالة التشغيلية الداخلية |
| الأصناف: الاسم، الطول، العرض، إجمالي السطر | `idempotency_key` / `request_hash` / `receipt_token_hash` |

التقنيع **في الداتابيز**، فمفيش احتمال إن تعديل في الواجهة يكشف حقل زيادة.

### 6.7 حالة «الإيصال غير متاح» — واحدة لكل الأسباب

الأسباب الأربعة دي **لازم** تدّي **نفس النتيجة بالحرف**:

1. الكوكي ناقص.
2. قيمة الكوكي غلط أو مزوّرة.
3. `receipt_expires_at` فات.
4. رقم الطلب مش موجود أصلاً.

النتيجة الموحّدة:

- **نفس حالة HTTP** (404).
- **نفس الصفحة ونفس النص بالحرف**: «الإيصال غير متاح» + «لو عندك رقم طلب، كلّمنا على
  واتساب» + زر «ارجع للمتجر».
- **ممنوع** أي تمييز بين «الطلب موجود بس مش مصرّح لك» و«الطلب مش موجود» — لا في النص،
  ولا في الحالة، ولا في الهيدرز، ولا في حجم الرد.
- **ممنوع** رسالة من نوع «رابط منتهي» أو «صلاحيتك خلصت» — دي بتأكّد إن الطلب موجود.

السبب: أي فرق بيحوّل الصفحة لـoracle بيسمح بتعداد أرقام الطلبات.

### 6.8 التنضيف

**مش في نطاق المرحلة الأولى.** `Max-Age` بيخلّي الكوكي ينتهي لوحده بعد ٧ أيام، ومفيش
راوت مسح. لو احتجنا مسح يدوي لجهاز مشترك لاحقاً، بيبقى إضافة مستقلة بمراجعة منفصلة.

---

## 7. الإشعار

### 7.1 قاعدة ثابتة

**الإشعار ما يوقّعش الطلب أبداً.** بيتبعت **بعد** الـcommit و**بعد** ما الرد يروح
للعميل. أي فشل = `notify_error` بس.

### 7.2 التوقيت، والـreplay (ب٦)

الطلب يلتزم → الرد يرجع فوراً (ومعاه الكوكي) → الإشعار جوه `after()` من `next/server`
(Next 15):
- زمن الاستجابة مش معلّق على تليجرام.
- حد الـ١٠ ثواني لدوال Hobby مش مهدّد.
- فشل الإشعار مستحيل يأثّر على الرد ولا على الكوكي.

**الـreplay ممنوع يبعت إشعار تاني.** حرسان:

1. الراوت بيستدعي الإشعار **فقط** لما `replayed === false`.
2. تحديث النجاح بيبقى `... where id = $1 and notified_at is null`.

### 7.3 الأساسي: تليجرام — متغيرات بيئة فقط (ت١ + ب٧)

- `POST https://api.telegram.org/bot<TOKEN>/sendMessage` بـ
  `AbortSignal.timeout(5000)`.
- `TELEGRAM_BOT_TOKEN` و`TELEGRAM_CHAT_ID` من `process.env` **فقط**.
- **ترتيب النقل (ب٧)، والخطوات مش بتتداخل:**
  1. الكود الجديد **يبطّل قراءة** `telegram_bot_token` و`telegram_chat_id` من
     `settings` — ما يقراهمش إطلاقاً.
  2. القيم من متغيرات بيئة سيرفر فقط.
  3. **التحقق** من مسار الإشعار على Production بطلب اختبار.
  4. **بعد كده** `0007_cleanup_notify_secrets.sql` **منفصلة** تحذف الصفّين.
  القيم فاضية حالياً، فالفصل ده فصل **إجرائي** عشان التنظيف ما يتداخلش مع التشغيل.
- `parse_mode: 'HTML'` مع تهريب `& < >` في كل قيمة. نص الرسالة من منطق
  `backend/lib/notifyMessage.ts` منقول لـ`packages/core/src/notifyMessage.ts`.
- المحتوى: رقم الطلب، الاسم، الموبايل كامل (قناة المالك الخاصة)، المحافظة، العنوان،
  الأصناف بأطوالها، الإجماليات، الملاحظات، وقت الطلب بتوقيت القاهرة.
  **ممنوع** رمز الإيصال في الرسالة.
- متغير ناقص = **مش خطأ**: `notify_error = 'TELEGRAM_NOT_CONFIGURED'` والطلب سليم (ق١).

### 7.4 `notify_email` — إعداد لوحة غير سرّي، وفاضي حالياً (ت٢)

- `notify_email` **مش سر** ويقدر يفضل في `settings` ويتعدّل من اللوحة. يفضل **بره**
  `PUBLIC_SETTING_KEYS`.
- **قيمته `""` على Production**، فالتعامل لازم يكون صريح:
  - الكود **ما يفترضش** إنه موجود؛ `trim()` فاضي → `NOTIFY_EMAIL_NOT_SET` مسجّل والطلب
    سليم.
  - **ممنوع فشل صامت:** لو كل قنوات الإشعار مش مظبوطة، ده يظهر **تحذير جاهزية في
    اللوحة** (نفس نمط `ReadinessBadge`)، مش في اللوج بس.
  - `docs/OPERATIONS.md` تتضمن خطوة «اظبط إيميل الإشعارات» في قايمة ما قبل التشغيل.
- **مفيش Resend ولا أي ناقل إيميل في المرحلة الأولى (ق١).** تليجرام بس.

### 7.5 التسجيل

- نجاح: `update orders set notified_at = now(), notify_error = null,
  updated_at = now() where id = $1 and notified_at is null` —
  **`updated_at` صريح إلزامي (مفيش triggers)**.
- فشل: `update orders set notify_error = $1, updated_at = now() where id = $2` بكود
  قصير بدون PII، مقصوص على ٢٠٠ حرف: `TELEGRAM_HTTP_401`، `TELEGRAM_TIMEOUT`،
  `TELEGRAM_NOT_CONFIGURED`، `NOTIFY_EMAIL_NOT_SET`. **ممنوع** نص الاستثناء الخام.
- التحديثين دول كتابة على `orders`، و`zell_order_writer` **مالوش `update`**. فبيتموا
  بمفتاح الباك إند خارج الـRPC. مقصود وموثّق.

### 7.6 اللوج

- **يُسجّل:** `orderNumber`، الكود الداخلي، مدة التنفيذ.
- **ما يُسجّلش أبداً:** الموبايل، الاسم، العنوان، الملاحظات، أي مفتاح أو توكن، الـbody
  الخام، رابط تليجرام كامل، **رمز الإيصال أو هيدر `Set-Cookie` أو قيمة أي كوكي** — لا
  في رد، ولا في خطأ، ولا في أي `console`.
- أي خطأ غير متوقّع: `error.name` بس (نفس نمط `describeFailure` في
  `supabaseServer.ts`).

---

## 8. الملفات بالتحديد

### جديد

| الملف | الغرض |
|---|---|
| `packages/core/src/orders.ts` | العقود + `OrderErrorCode` + جدول الرسائل + `canonicalizeOrderRequest` |
| `packages/core/src/notifyMessage.ts` | بنّاء نص الإشعار (منقول من `backend/lib`، بدون منصّة) |
| `apps/storefront/app/api/orders/route.ts` | **الراوت الوحيد** — الحدود، التحقق، الهاشين، توليد سر الإيصال، RPC، `Set-Cookie`، الرد، `after()` |
| `apps/storefront/app/order/[orderNumber]/page.tsx` | صفحة الإيصال — بتقرا الكوكي، `force-dynamic`، `no-store`، `noindex` |
| `apps/storefront/lib/data/receiptToken.ts` | توليد السر + hash + `receiptCookieName(orderNumber)` (`server-only`) |
| `apps/storefront/lib/data/orderRpc.ts` | `restRpc` — استدعاء PostgREST RPC (`server-only`) |
| `apps/storefront/lib/notify/telegram.ts` | ناقل تليجرام (`server-only`) |
| `apps/storefront/lib/orderFlags.ts` | قراءة `ORDERS_ENABLED` (`server-only`) |
| `backend/db/migrations/0006a_order_columns.sql` | §2.2 |
| `backend/db/migrations/0006b_order_functions.sql` | §2.3 + §3 + §6.5 |
| `backend/db/migrations/0007_cleanup_notify_secrets.sql` | **منفصلة، بعد التحقق** (ب٧) |
| `docs/ORDER-FLOW.md` | وثيقة تشغيل: المتغيرات، الأكواد، التراجع، الفحص |

**اتشال من القوايم السابقة:**
`lib/rateLimit.ts` (ب٢) · `lib/data/receipt.ts` بالـHMAC (ب٣) ·
`app/order/[orderNumber]/[receiptToken]/page.tsx` (ب٨) ·
`app/api/receipt-session/route.ts` و`app/api/receipt-session/clear/route.ts` (ب٩).

### معدّل

| الملف | التعديل |
|---|---|
| `packages/core/src/index.ts` | تصدير الوحدات الجديدة |
| `packages/core/src/pricing.ts` | **(ت٦)** شيل فرع الافتراضي من `computeShippingPiastres`؛ **(ت٣)** احترام المحافظات المقفولة؛ مطابقة ترتيب التقريب مع SQL |
| `packages/core/src/types.ts` | `StoreSettings.disabledGovernorates` |
| `apps/storefront/lib/data/mappers.ts` | **(ت٣)** ضم `shipping_disabled_governorates` لـ`PUBLIC_SETTING_KEYS` (غير سرّي) واستثناء المقفولة من `governorates` |
| `apps/storefront/components/store/CheckoutForm.tsx` | إرسال حقيقي، `submitting`، منع الضغط المزدوج، **`router.replace` مباشرة بعد النجاح**، عرض الخطأ من الكود، الحفاظ على السلة، `prop` اسمه `ordersEnabled`. **ممنوع `credentials: 'omit'`** (§6.3) |
| `apps/storefront/app/checkout/page.tsx` | تمرير `ordersEnabled` من السيرفر |
| `apps/storefront/next.config.mjs` | `Referrer-Policy: no-referrer` + `Cache-Control: no-store` على `/order/:orderNumber` |
| `apps/storefront/lib/cart.tsx` | مفيش تغيير منطقي — السلة تتنضّف **بعد** الرد الناجح |
| `apps/storefront/vercel.json` | `maxDuration` للراوت لو احتاج |
| `README.md`، `docs/ARCHITECTURE.md`، `docs/OPERATIONS.md`، `docs/DATA-ACCESS.md` | مسار الطلب، المتغيرات الجديدة، **«صفر أسرار في أي URL وأي JSON»**، و«المتجر ما بيلمسش أي جدول في مسار الطلب» |

### منقول لـ`docs/legacy/` — التاريخ ما يتحذفش (ب٥ + ق٥)

`backend/storefront/createOrder.ts`، `backend/lib/createOrderSql.ts`،
`backend/lib/orderNumber.ts`، `backend/lib/notifyMessage.ts`،
`backend/lib/notifyTransport.ts`، و`backend/db/migrations/0005a`+`0005b`+`0005c`.

كل ملف بياخد رأس بارز:

    ⚠️ مرجع تاريخي — لا تُنفّذ / HISTORICAL REFERENCE — DO NOT EXECUTE
    مكتوب لمنفّذ Retool. استُبدل بـ 0006a/0006b.
    السبب في docs/plans/ORDER-FLOW-PLAN.md §2.1

النقل بـ`git mv` عشان التاريخ يفضل متتبّع.

> **صفر لمسات** على `apps/admin/**` كله، `product_images`، رفع الصور، الأدوار،
> الإعدادات التشغيلية.

---

## 9. النشر والتراجع

### 9.1 بوّابة التشغيل

`ORDERS_ENABLED` — متغير بيئة **سيرفر** (ممنوع `NEXT_PUBLIC_`).
- غير مظبوط أو أي قيمة غير `true` = **مقفول**. غياب المتغير معناه مقفول، مش مفتوح.
- مقفول: `POST /api/orders` يرجّع 503 `ORDERS_DISABLED` قبل أي عمل و**من غير أي
  `Set-Cookie`**، **و** صفحة الدفع تعرض نفس البانر الحالي والزر `disabled`.
- صفحة `/order/<n>` **مش** محجوبة بالبوّابة: لو اتقفلت بعد طلبات حقيقية، الإيصالات
  القديمة تفضل شغّالة.
- نفس الدرس من `ADMIN_MUTATIONS_ENABLED`: **ممنوع زر مفعّل مالوش وظيفة.** الزر
  ما يتفعّلش غير لما `ordersEnabled && !submitting && !invalid`.

### 9.2 الترتيب

| # | الخطوة | نشرات Vercel |
|---|---|---|
| 1 | **دمج الوثيقة دي** | ٠ |
| 2 | كتابة `0006a` و`0006b` من الصفر كـPR مستقل ومراجعتهم (ت٤) | ٠ |
| 3 | تنفيذ `0006a` ثم `0006b` يدوي على Production، والتحقق إن الدالتين موجودتين وإن `zell_order_writer` **مالوش أي صلاحية جدول** | ٠ |
| 4 | نقل مسوّدات Retool لـ`docs/legacy/` (ب٥) — يقدر يبقى جوه PR الكود | ٠ |
| 5 | PR كود واحد. CI أخضر. الـSHA يُبعت للمراجعة. **مفيش دمج بدون موافقة صريحة.** | ٠ |
| 6 | دمج squash. المتجر **ما بيتغيّرش** (`ORDERS_ENABLED` غير مظبوط) | ١ |
| 7 | ضبط `ORDERS_ENABLED=true` + `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` على Vercel Production، و`notify_email` من اللوحة → **إعادة نشر إلزامية** | ١ |
| 8 | فحص دخان بطلبات اختبار واضحة التعريف (§10) | ٠ |
| 9 | **حذف طلبات الاختبار يدوي** قبل الإطلاق (ق٤) | ٠ |
| 10 | **بعد التحقق:** `0007_cleanup_notify_secrets.sql` (ب٧) | ٠ |

**نشرتين كفاية** (حصة Hobby). تحذير الخطوة ٧: المتغيرات لازمها **إعادة نشر**، مش بس
حفظ. **مفيش متغير `ORDER_RECEIPT_SECRET`** — اتلغى مع تصميم الـhash (ب٣).

### 9.3 التراجع

| المستوى | الإجراء | المدة | فقدان بيانات |
|---|---|---|---|
| فوري | شيل `ORDERS_ENABLED` + إعادة نشر | دقايق | لا |
| كود | `git revert` للـsquash commit + PR جديد | ساعة | لا |
| داتابيز | بالعكس: `drop function zell_get_order_receipt` → `zell_create_order` → `drop index orders_idempotency_key_uidx` → `drop column receipt_expires_at, receipt_token_hash, request_hash, idempotency_key` → `drop role zell_order_writer` | دقايق | الطلبات تفضل؛ أعمدة الـidempotency/الإيصال بس هي اللي تضيع |

الأعمدة nullable والدور مالوش أي صلاحية جدول، فالتراجع على الداتابيز **مش** بيمسح أي
طلب. والتراجع الفوري ما بيلمسش الداتابيز خالص.
كوكيز الإيصال اللي عند العملاء بتبقى بلا فايدة لوحدها بعد التراجع على الداتابيز (الدالة
مش موجودة → «غير متاح»)، وبتنتهي بـ`Max-Age`.

### 9.4 ترتيب نقل تليجرام (ب٧) — ملخّص

    (١) الكود يبطّل القراءة من settings
    (٢) متغيرات بيئة سيرفر فقط
    (٣) التحقق من مسار الإشعار
    (٤) migration تنظيف منفصلة تحذف الصفوف

**ممنوع** دمج الخطوة (٤) مع الخطوة (١) في نفس الـmigration أو نفس الـPR.

---

## 10. مصفوفة الاختبار

**البيئة (ب٤ + ق٤):** Production، بطلبات اختبار **واضحة التعريف** — الاسم يبدأ بـ
`TEST-` ورقم موبايل اختبار مخصّص واحد، و`internal_notes = 'TEST'` من اللوحة لما ينفع.
مقبول لأن `orders` فيها **صفر صفوف** دلوقتي، فكل صف موجود هو صف اختبار بالتعريف.
**كل طلبات الاختبار تتحذف يدوي قبل الإطلاق** (خطوة ٩ في §9.2).

| # | الحالة | الطريقة | المتوقّع |
|---|---|---|---|
| 1 | مسار سعيد | سلة بصنفين، بيانات سليمة | 201، `replayed: false`، صف واحد في `orders` + صفّين في `order_items`، الإجمالي = المعروض |
| 2 | **إعادة المحاولة** بنفس المفتاح ونفس البيانات | نفس `Idempotency-Key` ونفس الـbody مرتين | 200، `replayed: true`، **نفس رقم الطلب**، `count(orders) = 1` |
| 3 | إعادة المحاولة بعد خطأ شبكة | timeout من جهة العميل ثم إعادة بنفس المفتاح | طلب واحد بس في الداتابيز، والعميل بياخد كوكي شغّال وإيصال شغّال |
| 4 | نفس المفتاح ببيانات مختلفة | غيّر الطول في المحاولة التانية | 409 `IDEMPOTENCY_MISMATCH`، مفيش صف جديد، **ومفيش `Set-Cookie`** |
| 5 | ترتيب الأصناف مختلف | نفس المفتاح، السلة معكوسة | 200 `replayed: true` (التطبيع شغّال) |
| 6 | مسافات زايدة في الاسم | نفس المفتاح، «  أحمد » ضد «أحمد» | 200 `replayed: true` |
| 7 | **إرسالين متزامنين نفس المفتاح** | طلبين بالتوازي | واحد 201 والتاني 200 `replayed`؛ `count = 1`. **لو ظهر 409 لازم يكون `CONCURRENT_SUBMIT`، وممنوع `ITEM_UNAVAILABLE`** (ت٥) |
| 8 | إرسالين متزامنين بمفتاحين مختلفين | طلبين بالتوازي | طلبين، رقمين مختلفين، وكوكيين مختلفين |
| 9 | **سعر قديم** | تعديل السعر من اللوحة ثم إرسال من صفحة أقدم من ٥ دقايق | 201 بالسعر **الجديد** من الداتابيز؛ الإيصال يعرض الإجمالي الحقيقي |
| 10 | منتج اتقفل أثناء الدفع | `is_active = false` ثم إرسال | 409 `ITEM_UNAVAILABLE`، **صفر** صفوف، ومفيش `Set-Cookie` |
| 11 | **طول غير صالح** | أقل من `min`، أكبر من `max`، ومش مضاعف `step` | 409 `ITEM_UNAVAILABLE` في التلاتة، مفيش طلب ناقص |
| 12 | اسم/عنوان قصير | اسم حرفين، عنوان ٥ حروف | 400 `INVALID_NAME` / `INVALID_ADDRESS` |
| 13 | موبايل | `0123456789`، `+201012345678`، أرقام عربية | الأول 400، التاني والتالت ينجحوا بعد التطبيع |
| 14 | سلة فاضية / ٢١ صنف / ملاحظات ٦٠٠ حرف | — | 400 `CART_EMPTY` / `CART_TOO_LARGE` / `NOTES_TOO_LONG` |
| 15 | JSON مشوّه / `items` مش array / `items: [1,2]` / `Content-Type: text/plain` / body ٢٠٠ ك.ب | — | 400 `BAD_JSON` / `CART_INVALID` / 415 / 413. **مفيش 500 في أي حالة** |
| 16 | **محافظة مقفولة — الواجهة (ت٣)** | ضيفها لـ`shipping_disabled_governorates` من اللوحة | **مش ظاهرة** في القائمة المنسدلة بعد انتهاء الـrevalidate |
| 16ب | **محافظة مقفولة — المعاملة (ت٣)** | `curl` مباشر بالمحافظة المقفولة | 400 `GOVERNORATE_NOT_SERVED`، صفر صفوف |
| 17 | محافظة غير مخدومة | اسم مش في `rates` | 400 `GOVERNORATE_NOT_SERVED` |
| 18 | **دلالة الافتراضي (ت٦)** | محافظة في `disabled` لكن في `rates`؛ ومحافظة مش في `rates` خالص | الاتنين مرفوضين. **ممنوع** أي طلب يتسعّر بـ`shipping_default_piastres` |
| 19 | شحن مجاني | إجمالي ≥ العتبة | `shipping_piastres = 0` ومطابق للمعروض |
| 20 | إعدادات ناقصة | حذف مفتاح شحن مؤقتاً | 503 `SETTINGS_MISSING`، مفيش طلب ناقص |
| 21 | **نافذة الموبايل (ب٢)** | ٦ طلبات ناجحة لنفس الرقم المطبّع | السادس 429 `PHONE_DAILY_LIMIT` |
| 21ب | النافذة بتعدّ المطبّع | ٣ بـ`01012345678` و٣ بـ`+201012345678` | السادس 429 |
| 22 | **إشعار غير مظبوط (ت١+ت٢+ق١)** | شيل متغيرات تليجرام و`notify_email` فاضي | **201 عادي**؛ `notify_error = 'TELEGRAM_NOT_CONFIGURED'`؛ **تحذير جاهزية ظاهر في اللوحة** |
| 23 | **الـreplay ما يبعتش إشعار (ب٦)** | طلب ناجح ثم إعادة بنفس المفتاح | رسالة تليجرام **واحدة بس**؛ `notified_at` ما يتغيّرش |
| 24 | **فشل الإشعار** | توكن تليجرام غلط | 201 عادي، `notified_at` null، `notify_error = 'TELEGRAM_HTTP_401'`، مفيش PII ولا توكن في النص |
| 25 | مهلة الإشعار | تأخير > ٥ ثواني | 201 ورد سريع، `notify_error = 'TELEGRAM_TIMEOUT'` |
| 26 | **الرد مفيهوش سر (ب٩)** | فحص جسم رد `/api/orders` حرفياً | `ok` و`order` بس. **مفيش `receiptToken` ولا `receiptPath` ولا أي قيمة ٤٣ حرف** |
| 27 | **سمات الكوكي (§6.4)** | فحص هيدر `Set-Cookie` حرفياً | `HttpOnly` ✓ · `Secure` ✓ · `SameSite=Lax` ✓ · `Max-Age=604800` ✓ · `Path=/order/FLM-XXXXXX` **بالظبط** ✓ · **مفيش `Domain`** ✓ |
| 28 | **الكوكي مش بيتسرّب لمسار تاني** | افتح `/` و`/checkout` وابعت طلب تاني لـ`/api/orders` وراقب الكوكيز المبعوتة | الكوكي **مش مبعوت** في أي طلب غير `/order/FLM-XXXXXX` |
| 29 | **الكوكي مش مقروء من JavaScript** | `document.cookie` في الكونسول بعد طلب ناجح | **مفيش `zell_rcpt_*`** في الناتج |
| 30 | **إيصال سليم** | `/order/FLM-XXXXXX` بعد الطلب | الصفحة بتفتح، ورقم الطلب والإجماليات والأصناف صح |
| 31 | **التنقّل بـ`router.replace`** | إرسال من الواجهة بدون إعادة تحميل كامل | الصفحة بتفتح صح — الكوكي وصلت مع طلب الـRSC (`?_rsc=`) |
| 32 | **مفيش سر في الـURL** | شريط العنوان + التاريخ + لوجات Vercel | المسار `/order/FLM-XXXXXX` بس — **مفيش أي رمز في أي مكان** |
| 33 | **الإسقاط مقنّع (ق٦)** | فحص رد `zell_get_order_receipt` الخام | **مفيش عنوان خالص**، الموبايل آخر ٤ أرقام بس، مفيش `internal_notes` / `notify_error` / `idempotency_key` / `request_hash` / `receipt_token_hash` |
| 34 | **حالة «غير متاح» موحّدة (§6.7)** | ٤ حالات: بدون كوكي · كوكي مزوّر · كوكي منتهي · رقم طلب مش موجود | **نفس الحالة (404) ونفس النص بالحرف** في الأربعة. **ممنوع** أي فرق يكشف وجود الطلب |
| 35 | كوكي لطلب تاني | ابعت كوكي طلب A يدوي على مسار طلب B | نفس حالة «غير متاح» (والطبيعي إن الـ`Path` يمنع إرساله أصلاً) |
| 36 | تعداد | ٥٠ رقم طلب عشوائي من غير كوكي | ٥٠ × نفس الرد بالظبط، وزمن استجابة متقارب |
| 37 | **إيصالين بالتوازي** | طلبين في نفس المتصفح، افتح الإيصالين | **الاتنين شغّالين** في نفس الوقت (اسم كوكي لكل طلب) |
| 38 | **تدوير الرمز عند الـreplay (§4.3)** | طلب → احفظ قيمة كوكي ١ → replay → كوكي ٢ | كوكي ٢ شغّال، **وقيمة كوكي ١ بترجّع «غير متاح»** |
| 39 | هيدرز الصفحة | فحص هيدرز `/order/FLM-XXXXXX` | `Cache-Control: no-store` + `Referrer-Policy: no-referrer` |
| 40 | **صفر صلاحيات للدور (ت٧ + ب١)** | `has_table_privilege('zell_order_writer','public.orders', p)` لكل `p` في `select, insert, update, delete`؛ ونفسه لـ`order_items` و`products` و`settings` | **`false` في كلهم**. و`has_function_privilege` على الدالتين = `true` بس |
| 41 | **فحص تسريب (ت١ + §7.6)** | لوجات Vercel + كل ردود الأخطاء + `notify_error` + `pg_stat_statements` + `console` | مفيش موبايل/عنوان/اسم/توكن/**رمز إيصال**/هيدر `Set-Cookie`. السر الخام مش موجود في أي استعلام ولا مسار ولا لوج |
| 42 | ممنوع تخزين على العميل | `localStorage` و`sessionStorage` بعد طلب ناجح | `zell-order-intent` و`zell-cart-v2` بس — **مفيش رمز إيصال** |
| 43 | **الكوكي مش بتتفورورد لـSupabase** | فحص هيدرز استدعاء PostgREST | مفيش هيدر `Cookie` — الهاش بس هو اللي بيتبعت |
| 44 | **فخ `credentials` (§6.3)** | راجع كود `fetch` في `CheckoutForm` | **مفيش `credentials: 'omit'`**. ولو اتحطّت بالغلط، الاختبار ده يفشل لأن الإيصال يرجّع «غير متاح» |
| 45 | البوّابة مقفولة | شيل `ORDERS_ENABLED` | 503 `ORDERS_DISABLED` + **مفيش `Set-Cookie`** + الزر `disabled` + البانر ظاهر |
| 46 | إيصال قديم بعد قفل البوّابة | اقفل البوّابة بعد طلب ناجح | الإيصال القديم **لسه شغّال** (§9.1) |
| 47 | **السلة محفوظة عند الفشل** | أي خطأ من ١٠–٢٠ | السلة زي ما هي، البيانات في الحقول زي ما هي، الخطأ ظاهر جنب الزر |
| 48 | السلة تتنضّف عند النجاح بس | مسار سعيد | السلة فاضية **بعد** الرد الناجح والوصول للإيصال |
| 49 | ضغط مزدوج سريع | دوبل كليك + Enter | طلب شبكة واحد بس |
| 50 | تحديث الصفحة أثناء الإرسال | F5 وسط الطلب | إعادة إرسال بنفس المفتاح → replay، طلب واحد، إشعار واحد، وكوكي جديد |
| 51 | `updated_at` | بعد تسجيل الإشعار | `updated_at > created_at` |
| 52 | اللوحة تقرا الطلب | صفحة الطلبات في الأدمن | الطلب ظاهر بالأصناف والإجماليات صح |
| 53 | **تنضيف الاختبار (ق٤)** | بعد الفحص | كل طلبات `TEST-` محذوفة، `count(orders) = 0` قبل الإطلاق |

---

## 11. القرارات النهائية

### 11.1 الأسئلة الثمانية — كلها مُجابة ومقفولة

| # | السؤال | **القرار** |
|---|---|---|
| **ق١** | ناقل الإشعار | **تليجرام بس في المرحلة الأولى. لا Resend ولا أي اعتمادية إيميل.** فشل الإشعار ما يرجّعش الطلب أبداً، ولازم يكتب `notify_error` |
| **ق٢** | الحد اليومي | **٥ طلبات لكل رقم مطبّع / ٢٤ ساعة متجددة** |
| **ق٣** | صلاحية الإيصال | **٧ أيام** |
| **ق٤** | بيئة الاختبار | **Production بطلبات اختبار واضحة التعريف، تتحذف يدوي قبل الإطلاق. مفيش مشروع Supabase جديد** |
| **ق٥** | مسوّدات Retool | **تُنقل لـ`docs/legacy/` برأس تحذير بارز. التاريخ ما يتحذفش** |
| **ق٦** | العنوان في الإيصال | **مخفي بالكامل.** المحافظة بس + موبايل مقنّع |
| **ق٧** | اسم الدور | **`zell_order_writer`** |
| **ق٨** | تبادل بخطوتين ولا خطوة واحدة | **خطوة واحدة.** `POST /api/orders` بيضبط الكوكي في رده مباشرةً. `/api/receipt-session` وحقل الرمز في JSON وعقد التبادل و`RECEIPT_TOKEN_INVALID` **اتشالوا كلهم** |

**مفيش أسئلة مفتوحة.**

### 11.2 التحفّظات المسجّلة (مقبولة، مش منسيّة)

| # | التحفّظ | لماذا مقبول دلوقتي | محفّز إعادة النظر |
|---|---|---|---|
| ح١ | مفيش حد IP في التطبيق — مهاجم بأرقام كتير مش متوقّف (§5.3) | صفر طلبات، حجم صغير، والتراجع الفوري ثواني | أول حملة إعلانية، أو أول طلب مشبوه |
| ح٢ | **اتحلّت بالكامل بـب٨ + ب٩.** السر خرج من الـURL ومن الـJSON ومن ذاكرة JavaScript | `HttpOnly` + `Path` مقيّد + hash بس في الداتابيز + ٧ أيام + تدوير | — |
| ح٣ | دالتين `security definer` مملوكتين لمالك الجدول = نقطة ترقية صلاحيات (§2.3) | جسم ثابت، مفيش SQL ديناميكي، مدخلات قيم بسيطة، منح محصور | أي تعديل على جسم أي دالة = مراجعة أمنية جديدة |
| ح٤ | `service_role` لسه بيتخطى RLS (§2.6) | الحد الحقيقي هو كود التطبيق، والمتجر ما بيلمسش أي جدول في مسار الطلب | استبدال المفتاح بدور مقيّد = متغير بيئة واحد |
| ح٥ | الـreplay بيدوّر رمز الإيصال (§4.3) | إثبات الملكية = نفس المفتاح + نفس الطلب بالبايت؛ القديم يبطل | لو احتجنا أكتر من رمز صالح في نفس الوقت |
| ح٦ | حدود المتصفح للكوكيز لكل نطاق (§6.4) | عميل بمئات الطلبات في ٧ أيام مش حالة واقعية | لو ظهر عميل جملة بيعمل طلبات كتير |
| ح٧ | الإيصال مربوط بالمتصفح — جهاز تاني مش هيفتحه | الإيصال تأكيد فوري مش أرشيف؛ التواصل على واتساب برقم الطلب | لو طُلب «اعرض طلباتي» لاحقاً، ده بيحتاج حساب عميل — نطاق منفصل |

---

## ملحق — مصادر الفحص

كل رقم وكل اسم عمود في الوثيقة دي **مقروء**، مش مستنتج:

- `information_schema.columns`، `pg_indexes`، `pg_proc`، `pg_roles`، `pg_policies`
  على Supabase Production (قراءة فقط).
- `settings` — المفاتيح وأنواعها وأطوالها (بدون كشف أي قيمة سرّية).
- ملفات الريبو على `main` عند `70474369b4940896c0198fcbb1628fe7b2335b1c`:
  `README.md`، `docs/ARCHITECTURE.md`، `docs/DEVELOPMENT.md`، `docs/OPERATIONS.md`،
  `docs/DATA-ACCESS.md`، `docs/ADMIN-MUTATIONS.md`،
  `docs/future/MERCHANDISING-EXTENSIBILITY.md`،
  `backend/db/migrations/0005a`+`0005b`+`0005c`،
  `backend/storefront/createOrder.ts`، `backend/lib/createOrderSql.ts`،
  `backend/lib/orderNumber.ts`، `backend/lib/notifyMessage.ts`،
  `backend/lib/notifyTransport.ts`، `packages/core/src/validation.ts`،
  `packages/core/src/orderNumber.ts`، `packages/core/src/pricing.ts`،
  `apps/storefront/lib/cart.tsx`، `apps/storefront/lib/data/source.ts`،
  `apps/storefront/lib/data/queries.ts`، `apps/storefront/lib/data/mappers.ts`،
  `apps/storefront/lib/data/supabaseServer.ts`،
  `apps/storefront/components/store/CheckoutForm.tsx`.

**نهاية الوثيقة — خطة فقط، لم تُنفّذ.**
