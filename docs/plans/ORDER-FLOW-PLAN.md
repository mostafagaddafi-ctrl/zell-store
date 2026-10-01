# FUTURE IMPLEMENTATION PLAN — NOT EXECUTED

> **خطة تنفيذ مستقبلية — لم تُنفّذ.**
>
> الوثيقة دي **خطة فقط**. مفيش كود اتكتب، مفيش SQL اتنفّذ، مفيش تغيير على Production،
> ومفيش تفعيل لإرسال الطلب. الهدف منها المراجعة والموافقة قبل أي سطر كود.
>
> | | |
> |---|---|
> | الحالة | مسودة للمراجعة — غير منفّذة |
> | `main` وقت الفحص | `70474369b4940896c0198fcbb1628fe7b2335b1c` |
> | البيئة المفحوصة | Supabase Production (قراءة فقط) |
> | النطاق | `apps/storefront` + `packages/core` + migrations جديدة |
> | خارج النطاق | `apps/admin`، رفع الصور، الأدوار، الإعدادات التشغيلية |

---

## ملخّص تنفيذي

تشغيل الطلب الحقيقي محتاج ٤ حاجات مترتبة: **(١)** طبقة داتابيز جديدة (رقم الطلب،
الـidempotency، معاملة إنشاء الطلب الذرّية، ودوال قراءة ضيّقة)، **(٢)** راوت
`POST /api/orders` في المتجر، **(٣)** صفحة إيصال محمية برمز موقّع، **(٤)** إشعار
تليجرام بعد الالتزام. كل ده خلف بوّابة `ORDERS_ENABLED` مقفولة افتراضياً.

أهم ٤ حقائق من الفحص:

1. **ولا واحدة من مسوّدات migrations الطلب اتنفّذت على Production** — وده مؤكَّد من
   الداتابيز نفسها، مش من التعليقات.
2. **المسوّدات القديمة `0005a/0005b/0005c` مرفوضة للتنفيذ كما هي** ومحتاجة مراجعة
   جديدة واستبدال كامل (توجيه معتمد — §0.4).
3. جدول `settings` فيه خانة لتوكن بوت تليجرام — **مكان تخزين خاطئ لسر** ولازم ينتقل
   لمتغيرات بيئة سيرفر فقط.
4. `shipping_disabled_governorates` بتتكتب من اللوحة و**مالهاش أي أثر** لا في المتجر
   ولا في مسودة المعاملة — تسريب طلبات حقيقي.

---

## 0. حالة البداية الحقيقية (مفحوصة، مش مفترضة)

### 0.1 مفيش أي migration للطلب على Production

الريبو فيه ٣ مسوّدات، كلها معلّمة صريح «الحالة: مسودة — لم تُنفّذ»:

| الملف | المفروض يعمل إيه | موجود في Production؟ |
|---|---|---|
| `backend/db/migrations/0005a_generate_order_number.sql` | `generate_order_number('FLM')` | لا |
| `backend/db/migrations/0005b_order_idempotency.sql` | `idempotency_key` + `request_hash` + فهرس فريد جزئي | لا |
| `backend/db/migrations/0005c_create_order_function.sql` | دور `zell_definer` + سياسات RLS + `create_order` | لا |

تأكيد مباشر من الداتابيز:

- الدوال الموجودة في `public`: `zell_reorder_product_images`، `zell_reorder_products`،
  `zell_save_content`، `zell_save_identity`، `zell_save_shipping`،
  `zell_set_primary_product_image`، `zell_valid_benefits` — **مفيش**
  `generate_order_number` ولا `create_order`.
- فهارس `orders`: `orders_pkey`، `orders_order_number_key`، `orders_created_at_idx`،
  `orders_phone_idx`، `orders_status_idx` — **مفيش** فهرس idempotency.
- أعمدة `orders`: `id, order_number, status, customer_name, customer_phone,
  governorate, address, notes, subtotal_piastres, shipping_piastres, total_piastres,
  notified_at, notify_error, created_at, updated_at, internal_notes` — **مفيش**
  `idempotency_key` ولا `request_hash`.
- أدوار `zell%`: **صفر**. سياسات RLS: **صفر** (RLS مفعّل من غير أي policy).
- `orders`: **صفر صفوف**.

### 0.2 ملاحظات بنية مؤثّرة على التصميم

1. `orders.order_number`: `text NOT NULL UNIQUE` **من غير default** → الرقم لازم
   يتولّد في نفس عبارة الإدخال.
2. `orders.updated_at`: `NOT NULL default now()` و**مفيش trigger** في المشروع كله.
   الإدخال سليم؛ أي `update` لاحق لازم يبعت `updated_at` صريح.
3. `order_items.length_cm` و `width_cm`: `NOT NULL` + `CHECK > 0` → العقد خاص بالبيع
   بالمتر الطولي. (نماذج التسعير التانية موثّقة في
   `docs/future/MERCHANDISING-EXTENSIBILITY.md` ومحتاجة تخفيف ٧ قيود `NOT NULL` —
   **خارج نطاق الخطة دي تماماً**.)
4. `order_items.product_id` nullable + لقطة مجمّدة (`product_name_ar`،
   `product_image_url`، `unit_price_piastres`، `width_cm`) → حذف منتج ما بيفسدش طلب
   قديم. التصميم ده يفضل كما هو.
5. المسوّدات في `backend/` (`storefront/createOrder.ts`، `lib/createOrderSql.ts`،
   `lib/orderNumber.ts`، `lib/notifyMessage.ts`، `lib/notifyTransport.ts`) مكتوبة
   **لمنفّذ Retool** (`supabase.query(...)` و `retoolEmail`) — مرجع تصميم، مش كود
   قابل للنشر على Vercel.
6. `packages/core/src/orderNumber.ts` نسخة نضيفة من المولّد + `isValidOrderNumber` —
   قابلة للاستخدام فوراً للتحقق من شكل رقم الطلب.
7. المتجر فيه `restGet` بس (`apps/storefront/lib/data/supabaseServer.ts`) —
   **مفيش أي helper كتابة ولا RPC**.
8. `apps/storefront/components/store/CheckoutForm.tsx`: الزر `disabled` ثابت في الكود
   + بانر «تأكيد الطلب لسه مش مفعّل»، و`onSubmit` بيعمل `setTouched(true)` وخلاص.
9. `REVALIDATE_SECONDS = 300` → الصفحة ممكن تعرض سعر عمره ٥ دقايق. ده يخلّي «السعر
   النهائي من الداتابيز» **شرط إلزامي**، مش تحسين.
10. الـAPI route الوحيد في الريبو هو
    `apps/admin/app/api/admin/products/[productId]/images/route.ts` — نفس النمط
    والحدود (٤MB واجهة / ٥MB سيرفر، حد Vercel Hobby ~٤٫٥MB) هو المرجع.
11. `PUBLIC_SETTING_KEYS` في `apps/storefront/lib/data/mappers.ts` allowlist بـ٨
    مفاتيح، بتتستخدم مرتين (فلتر الاستعلام + حارس تاني وقت التحويل) — فـ`notify_email`
    و`telegram_*` **ما بيوصلوش** للمتجر. الحارس ده يفضل كما هو.

### 0.3 الفرجات المكتشفة

**(أ) سر في الداتابيز.** `settings` فيه `telegram_bot_token` و`telegram_chat_id`
(الاتنين `""` حالياً). وجود خانة لتوكن بوت في جدول بيتعدّل من اللوحة يخالف قاعدة
«مفيش أسرار في أي مكان»: أي صلاحية على اللوحة أو على `service_role` تقراه، وأي
تصدير أو لوج للإعدادات يسرّبه.

**(ب) المحافظات المقفولة مش بتتقفل فعلاً.** `shipping_disabled_governorates` موجود
(حالياً `[]`) و`zell_save_shipping` بيكتبه، بس:
- المتجر **ما يقراهوش** — مش في `PUBLIC_SETTING_KEYS`، و`toStoreSettings` بيحسب
  `governorates` = مفاتيح `shipping_rates` مرتّبة.
- مسودة `0005c` بتتحقق `v_rates ? p_governorate` بس.

يعني قفل محافظة من اللوحة = هي تفضل في القائمة المنسدلة **وتقبل طلبات**.

**(ج) `shipping_default_piastres` دلالته متناقضة.** `computeShippingPiastres` في
`packages/core/src/pricing.ts` بيرجع للقيمة الافتراضية لو المحافظة مش في `rates`،
بينما `0005c` بترفض الطلب أصلاً في نفس الحالة. اختلاف صامت بين المعروض والمحسوب.

**(د) `notify_email` فاضي.** مفتاح **غير سرّي** (إيميل استقبال إشعارات، مش بيانات
اعتماد)، بس قيمته `""` على Production. لو الإشعار اعتمد عليه من غير فحص صريح،
الطلبات تنجح بصمت من غير ما حد يعرف.

### 0.4 التوجيهات المعتمدة (مُقرّة — غير قابلة للنقاش في مراجعة الكود)

| # | التوجيه | الأثر على الخطة |
|---|---|---|
| **ت١** | توكن تليجرام و chat id **لازم** ينتقلوا لمتغيرات بيئة سيرفر فقط. **ممنوع** تخزين أسرار في `settings`. | §7.3، §8، §9.2، واختبار ٣٨ |
| **ت٢** | `notify_email` يقدر يفضل إعداد لوحة **غير سرّي**، بس هو فاضي حالياً والإشعار **لازم** يتعامل مع الحالة دي صريح. | §7.4، §7.5، واختبار ٢٥ |
| **ت٣** | المحافظات المقفولة **لازم** تُفرض في **الاتنين**: خيارات المتجر **و** معاملة الطلب الموثوقة. | §2.3، §3.3، §8، واختبار ١٩ + ١٩ب |
| **ت٤** | **ممنوع تنفيذ** مسوّدات `0005a/0005b/0005c` كما هي. محتاجة مراجعة جديدة واستبدال. | §2 بالكامل أعيد تأسيسه |
| **ت٥** | كود خطأ **منفصل** للتزامن. **ممنوع** تعيين حالة التسابق على `ITEM_UNAVAILABLE`. | §1.3، §3.3، §4.4، واختبار ٧ |
| **ت٦** | دلالة `shipping_default_piastres` **لازم** تتوحّد بين عرض المتجر وسلطة الداتابيز. | §2.6، §3.3، §8 |
| **ت٧** | **ممنوع** الموافقة على `orders_read_for_definer using (true)`. الـidempotency والوصول للإيصال يُعاد تصميمهم **بدون أي قراءة واسعة للطلبات**. | §2.5 (تصميم جديد)، §3.3، §6.4، §8 |

---

## 1. عقود الطلب (TypeScript)

مكانها المقترح: `packages/core/src/orders.ts` + تصدير من `packages/core/src/index.ts`.

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

`Idempotency-Key` **هيدر** مش حقل في الـbody — عشان الهاش يغطّي البيانات بس، فيبقى
المفتاح والهاش مستقلّين: نفس البيانات بمفتاح جديد = طلب جديد مقصود؛ نفس المفتاح
ببيانات مختلفة = تضارب.

### 1.2 الرد

    export type OrderSuccess = {
      ok: true
      orderNumber: string        // FLM-XXXXXX
      replayed: boolean          // true لو إعادة تسليم لنفس المفتاح
      subtotalPiastres: number
      shippingPiastres: number
      totalPiastres: number
      itemCount: number
      receiptToken: string
      receiptPath: string        // '/order/FLM-XXXXXX?t=...' جاهز للتوجيه
    }

    export type OrderFailure = {
      ok: false
      code: OrderErrorCode       // كود داخلي ثابت
      message: string            // عربي ثابت مشتق من الكود — مش من الاستثناء
      retryable: boolean
    }

    export type OrderResponse = OrderSuccess | OrderFailure

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
| `RATE_LIMITED` | 429 | طلبات كتير في وقت قصير. استنى شوية وجرّب تاني. | أيوه |
| `PHONE_DAILY_LIMIT` | 429 | وصلت لأقصى عدد طلبات لنفس الرقم في اليوم. كلّمنا على واتساب. | لا |
| `SETTINGS_MISSING` | 503 | في مشكلة مؤقتة في إعدادات الشحن. كلّمنا على واتساب. | أيوه |
| `ORDER_NUMBER_EXHAUSTED` | 503 | مشكلة مؤقتة. جرّب تاني بعد لحظة. | أيوه |
| `INTERNAL` | 500 | حصلت مشكلة غير متوقّعة. كلّمنا على واتساب. | أيوه |

**`CONCURRENT_SUBMIT` كود مستقل إلزامي (ت٥).** حالة التسابق **ممنوع** تتحوّل لرسالة
«صنف غير متاح» — دي رسالة بتخلّي العميل يعدّل سلة سليمة ويعمل طلب تاني.

> **السعر القديم:** مفيش كود `PRICE_CHANGED` من السيرفر. القرار: **ما نقبلش أي رقم
> من العميل إطلاقاً**، والإجمالي الحقيقي يتعرض في صفحة الإيصال بوضوح. ده يمنع أي
> تسرّب لمنطق تسعير للعميل، وبيلغي مسار تأكيد بخطوتين غير مطلوب دلوقتي.

---

## 2. طبقة الداتابيز الجديدة

### 2.1 المسوّدات القديمة: مرفوضة للتنفيذ (ت٤)

`0005a` و`0005b` و`0005c` **مش بتتنفّذ، لا كما هي ولا بتعديل جزئي.** الأسباب:

1. `0005c` فيها `orders_read_for_definer using (true)` — مرفوضة صريح (ت٧)، والرفض ده
   بيكسر تصميم الـreplay والحد اليومي اللي مبني عليها، فالدالة محتاجة إعادة تأسيس مش
   تعديل سطر.
2. فيها فرجة المحافظات المقفولة (ت٣).
3. فيها تناقض `shipping_default_piastres` (ت٦).
4. بتعيّن حالة التسابق على `ZELL_ITEM_UNAVAILABLE` (ت٥).
5. مكتوبة وقت ما المنفّذ كان Retool (`grant execute ... to postgres`)، والسياق بقى
   Vercel + PostgREST.

**الإجراء:** مجموعة migrations **جديدة** تُكتب من الصفر بعد الموافقة على الوثيقة دي،
وتمر بمراجعة مستقلة. المسوّدات القديمة تُعلّم «SUPERSEDED — DO NOT RUN» في PR كود
منفصل (مش في PR الوثيقة ده).

المعرفة المستخرجة منها **تُعاد استخدامها** لأنها سليمة ومتحقَّق منها:
- الضمانة الحقيقية لرقم الطلب هي القيد الفريد + إعادة المحاولة، مش فحص الوجود.
- الهاش يُحسب في الباك إند (`pg_catalog.sha256` غير موثوق هنا، و pgcrypto في schema
  `extensions`).
- **تحديد المعدّل ممنوع في الداتابيز**: أي `raise exception` بيرجّع العدّاد، فالمهاجم
  ما بيتعدّش أبداً. مكانه الباك إند خارج الـtransaction.
- تحقق آمن من شكل الـJSON **قبل** أي `cast`.
- `search_path = ''` + `pg_catalog.` صريح على كل دالة مدمجة.
- `revoke all from public, anon, authenticated` **قبل** أي `grant` (`PUBLIC` بتتمنح
  تلقائياً).
- سياسة الـreplay مبنية على وجود المفتاح، مش على نافذة ٢٤ ساعة.

### 2.2 المجموعة الجديدة المقترحة

| الملف | المحتوى |
|---|---|
| `0006a_order_number.sql` | `generate_order_number(p_prefix text default 'FLM')` |
| `0006b_order_idempotency.sql` | `idempotency_key` + `request_hash` + قيود + فهرس فريد جزئي |
| `0006c_order_read_helpers.sql` | ٣ دوال قراءة **ضيّقة** (§2.5) — **قبل** المعاملة لأنها بتعتمد عليها |
| `0006d_order_transaction.sql` | دور `zell_order_writer` + سياسات + `create_order` |

ترتيب التنفيذ: a ← b ← c ← d. كل ملف `begin/commit` مستقل وقابل للتراجع لوحده.

### 2.3 `0006a` + `0006b` — الأساسيات

**مولّد الرقم:** صيغة `FLM-XXXXXX`، أبجدية ٣٢ حرف من غير `O/0/I/1` (لبس صوتي على
التليفون)، عشوائية من `gen_random_uuid()` (مدمج في PG13+، مش محتاج pgcrypto)،
`security invoker`، `set search_path = ''`.

**الـidempotency:**

    alter table orders add column idempotency_key text;
    alter table orders add column request_hash   text;
    -- قيود شكل
    check (idempotency_key is null or length(btrim(idempotency_key)) between 16 and 128)
    check (request_hash    is null or request_hash ~ '^[0-9a-f]{64}$')
    -- فهرس فريد جزئي = نقطة الذرّية الوحيدة
    create unique index orders_idempotency_key_uidx
      on orders (idempotency_key) where idempotency_key is not null;

- الأعمدة nullable → الطلبات اليدوية من اللوحة تفضل صالحة، والتراجع آمن.
- **شرط حرج:** predicate الفهرس لازم يطابق **حرفياً** جملة `on conflict ... where ...`
  في `0006d`، وإلا بوستجريس ما بيستخدمش الفهرس والـ`on conflict` بيفشل.

### 2.4 نقطة أمانة لازم تتكرر في الوثائق

المتجر دلوقتي بيستخدم `SUPABASE_SERVICE_ROLE_KEY` (أو `SUPABASE_READ_KEY` لو اتظبط)،
و`service_role` **بيتخطى RLS بالكامل**. يعني أي دور وأي سياسة RLS **مش** حد أمان
فعّال اليوم؛ الحد الحقيقي هو كود التطبيق. قيمتهم إنهم الشرط المسبق لإلغاء
`service_role` لاحقاً. نفس التوضيح الموجود في `docs/DATA-ACCESS.md`.

### 2.5 `0006c` — قراءة ضيّقة، صفر قراءة واسعة للطلبات (ت٧)

**المبدأ:** ولا دور ولا مسار كود بياخد `select` على `public.orders`. كل قراءة محتاجة
بتمر على دالة `security definer` **مملوكة لمالك الجدول**، جسمها أسطر معدودة، وبترجع
**إسقاط محدّد** مش صفوف.

| الدالة | المدخل | الراجع | ليه مش قراءة واسعة |
|---|---|---|---|
| `order_replay_lookup(p_idempotency_key text)` | مفتاح واحد | `jsonb`: `order_number`، `request_hash`، الإجماليات الـ٣ | **صفر PII**. مفيش اسم ولا موبايل ولا عنوان ولا ملاحظات. بحث بمفتاح دقيق، صف واحد كحد أقصى |
| `order_phone_window_count(p_phone text)` | موبايل واحد | `integer` | **عدد فقط**. مفيش أي صف بيرجع |
| `order_receipt_projection(p_order_number text)` | رقم طلب واحد | `jsonb`: رقم الطلب، الإجماليات، `created_at`، المحافظة، الاسم الأول، آخر ٤ أرقام من الموبايل، الأصناف | الإخفاء والتقنيع بيحصلوا **في الداتابيز**. **ممنوع** رجوع العنوان أو `internal_notes` أو `notify_error` أو الحالة التشغيلية |

قواعد ثابتة للتلاتة:
- `security definer`، `set search_path = ''`، `stable`، `pg_catalog.` صريح.
- `revoke all on function ... from public, anon, authenticated` **قبل** أي منح.
- `grant execute` لدور الكتابة ولمفتاح الباك إند **بس**.
- الجسم **ما يقبلش** أي شرط من المستدعي — بحث بمفتاح واحد وخلاص. مفيش `where` قابل
  للتمرير، مفيش `limit`، مفيش `order by` من بره.

> **المقايضة مكتوبة صريح:** دالة `security definer` مملوكة لمالك الجدول هي ترقية
> صلاحيات مقصودة. مقبولة **فقط** لأن الجسم ثابت وضيّق والمخرج إسقاط مقنّع. ده أضيق
> بكتير من `grant select on orders` + `using (true)` اللي كانت بترجّع الاسم والموبايل
> والعنوان والملاحظات لكل الطلبات.

### 2.6 `0006d` — الدور والمعاملة

**الدور** `zell_order_writer` (اسم جديد بدل `zell_definer` — الاسم القديم بقى مضلّل
بعد ما القراءة اتشالت): `nologin nobypassrls`، وصلاحياته:

| المورد | الصلاحية |
|---|---|
| `products` | `select` (بسياسة `is_active`) |
| `settings` | `select` محصورة في ٤ مفاتيح: `shipping_rates`، `shipping_default_piastres`، `free_shipping_threshold_piastres`، `shipping_disabled_governorates` |
| `orders` | `insert` **فقط** — **مفيش `select`، مفيش `update`، مفيش `delete`** |
| `order_items` | `insert` فقط |
| sequences | `usage` |
| الدوال | `execute` على `generate_order_number` + التلات دوال في §2.5 |

**فرق جوهري عن المسودة القديمة:** مفيش `orders_read_for_definer` خالص. سياسة
`select` على `orders` للدور ده **مش موجودة**.

**دلالة الشحن الموحّدة (ت٦)** — القاعدة الواحدة، في مكان واحد:

1. المحافظة **لازم** تكون مفتاح في `shipping_rates`.
2. المحافظة **لازم** تكون **مش** في `shipping_disabled_governorates`.
3. الشحن = `shipping_rates -> governorate`.
4. لو `free_shipping_threshold_piastres > 0` والإجمالي الفرعي ≥ العتبة → الشحن = ٠.
5. `shipping_default_piastres` **مش جزء من تسعير الطلب**. دوره الوحيد: القيمة
   المقترحة في اللوحة لما المالك يضيف محافظة جديدة.

نتيجة ده: `computeShippingPiastres` في `packages/core` يتشال منه فرع الرجوع
للافتراضي، ويتحول لمصدر واحد مطابق حرفياً لمنطق الداتابيز. البديل (نخلّي الافتراضي
سلطة في الاتنين) **مرفوض** لأنه بيخلّي محافظة محذوفة من `rates` تقبل طلبات بسعر
افتراضي من غير قرار صريح من المالك.

---

## 3. تصميم المعاملة

### 3.1 القاعدة

**استدعاء واحد = transaction واحد.** الراوت بيعمل `POST /rest/v1/rpc/create_order`
مرة واحدة. مفيش أي خطوتين على الداتابيز قبل الـcommit، فمستحيل يحصل «طلب موجود من
غير أصناف».

### 3.2 التوقيع

    create_order(
      p_items jsonb, p_customer_name text, p_customer_phone text,
      p_governorate text, p_address text, p_notes text,
      p_idempotency_key text, p_request_hash text
    ) returns jsonb

### 3.3 التسلسل جوه الدالة

1. تحقق مفتاح الـidempotency (١٦–١٢٨ بعد `btrim`) والهاش (٦٤ حرف hex صغير).
2. تحقق نصّي: الاسم ≥ ٣، الموبايل `^01[0125][0-9]{8}$`، العنوان ≥ ٨،
   الملاحظات ≤ ٥٠٠.
3. تحقق **آمن** من شكل السلة **قبل** أي `cast`: `jsonb_typeof = 'array'`، الطول
   ١..٢٠، كل عنصر `object` فيه `productId` و`lengthCm` مطابقين لregex أرقام موجبة.
4. قراءة إعدادات الشحن: `shipping_rates` (object)، `free_shipping_threshold_piastres`
   (number)، `shipping_disabled_governorates` (array). ناقص أو نوع غلط →
   `ZELL_SETTINGS_MISSING`. **`shipping_default_piastres` مش مقروء هنا** (ت٦).
5. **المحافظة (ت٣):** موجودة في `rates` **و** مش في `disabled` → غير كده
   `ZELL_GOVERNORATE_NOT_SERVED`.
6. الحد اليومي: `order_phone_window_count(p_customer_phone)` ≥ الحد →
   `ZELL_PHONE_DAILY_LIMIT`. (عدد فقط، مفيش قراءة صفوف — ت٧.)
7. حلقة ٥ محاولات، كل محاولة جوه `begin ... exception when unique_violation`، وجواها
   **عبارة CTE واحدة**:
   - `req` — فك السلة.
   - `priced` — `join products` بشرط `is_active` و `length_cm between min and max` و
     `((length_cm - min) % step) = 0`، و `line_total = round(price_per_meter *
     length_cm / 100.0)`.
   - `totals` — المجموع و `ok_count`.
   - `ship` — السعر من `rates`، والشحن ٠ لو العتبة اتحققت.
   - `new_order` — `insert into orders ... select generate_order_number(), ...
     where ok_count > 0 and ok_count = (select count(*) from req)`
     + `on conflict (idempotency_key) where idempotency_key is not null do nothing`
     + `returning`.
     - **الشرط `ok_count = count(req)` هو قلب الذرّية:** أي صنف مرفوض = الطلب
       مايتعملش أصلاً. مفيش طلب ناقص.
   - `items_ins` — `insert into order_items ... from new_order cross join priced`
     (صفر طلب → صفر أصناف تلقائياً).
   - `select` نهائي من `new_order`؛ نجاح → `exit`.
   - `unique_violation`: `get stacked diagnostics` — لو القيد
     `orders_order_number_key` → محاولة جديدة برقم جديد؛ أي قيد تاني → `raise` كما هو؛
     استنفاد المحاولات → `ZELL_ORDER_NUMBER_EXHAUSTED`.
8. **لو صفر صفوف** — تمييز تلاتي إلزامي:
   - `order_replay_lookup(p_idempotency_key)` رجّع صف **و** `request_hash` مطابق →
     **replay**: `replayed: true` بنفس الأرقام.
   - رجّع صف **و** الهاش مختلف → `ZELL_IDEMPOTENCY_MISMATCH`.
   - رجّع ولا حاجة:
     - لو الإدخال كان `on conflict` فعلاً (يعني كان فيه صف متعارض لحظة الإدخال) →
       **`ZELL_CONCURRENT`** (ت٥).
     - غير كده → `ZELL_ITEM_UNAVAILABLE`.
9. رجّع `jsonb`: `order_number`، الإجماليات، عدد الأصناف، `replayed`.

### 3.4 ملاحظات ذرّية

- `ON CONFLICT DO NOTHING` بيستنى الـtransaction المتعارضة تخلص قبل ما يتجاهل، فالقراءة
  اللي بعده بتشوف الصف المعتمد. ده اللي بيحوّل التسابق لـreplay نضيف.
- `round()` مرة واحدة لكل سطر في `priced` ثم الجمع — **لازم** يطابق ترتيب
  `computeSubtotalPiastres` حرفياً، وإلا فرق قرش بين المعروض والمحسوب.
- كل الأرقام قروش صحيحة (`integer`). مفيش `numeric` ولا عشري في أي مكان.

---

## 4. خوارزمية الـidempotency

### 4.1 توليد المفتاح (العميل)

- عند أول `submit`: `crypto.randomUUID()` (٣٦ حرف، جوه نطاق ١٦–١٢٨).
- يُخزّن في `useRef` **و** `sessionStorage['zell-order-intent']` → تحديث الصفحة أو
  إعادة المحاولة بيستخدموا نفس المفتاح.
- يتجدّد **فقط** بعد نجاح، أو بعد خطأ `retryable: false` والمستخدم عدّل البيانات.
- إعادة المحاولة بعد خطأ شبكة أو 5xx أو 429 = **نفس المفتاح**.

### 4.2 حساب الهاش (السيرفر فقط)

العميل **ما بيبعتش هاش**. السيرفر بيحسبه بعد التطبيع:

1. `trim` للاسم والعنوان؛ الملاحظات `trim` ثم فاضي → `null`.
2. `normalizePhone(raw)` من `packages/core/src/validation.ts` (بيحوّل الأرقام العربية،
   يشيل `0020`/`20`، يضيف الصفر).
3. `items` مرتّبة تصاعدياً بـ`productId` ثم `lengthCm` — ترتيب السلة ما يخلقش مفتاح
   مختلف لنفس الطلب.
4. كائن قانوني بترتيب مفاتيح ثابت → `JSON.stringify` → `TextEncoder` →
   `crypto.subtle.digest('SHA-256')` → hex صغير.

التطبيع قبل الهاش **ضروري**: لولاه «احمد » و«احمد» يبقوا طلبين مختلفين بنفس المفتاح
= `IDEMPOTENCY_MISMATCH` كاذب.

### 4.3 سلوك السيرفر

| الحالة | النتيجة |
|---|---|
| مفتاح جديد، سلة سليمة | 201 + `replayed: false` |
| نفس المفتاح + نفس الهاش | 200 + `replayed: true` (نفس رقم الطلب والأرقام) |
| نفس المفتاح + هاش مختلف | 409 `IDEMPOTENCY_MISMATCH` |
| مفتاح ناقص أو طوله غلط | 400 `IDEMPOTENCY_REQUIRED` |
| تسابق على نفس المفتاح والفايز رجع للخلف | 409 `CONCURRENT_SUBMIT` |

### 4.4 التزامن

- **نفس المفتاح، طلبين في نفس اللحظة:** الفهرس الفريد الجزئي هو نقطة الحكم. الخسران
  بياخد صفر صفوف، يستنى، يلاقي صف الفايز عن طريق `order_replay_lookup`، يرجّع replay.
  **طلب واحد بس بيتكوّن.**
- **الحالة النادرة** (الفايز رجع للخلف) → `CONCURRENT_SUBMIT`، **مش**
  `ITEM_UNAVAILABLE` (ت٥).
- **منع الضغط المزدوج في الواجهة:** `submitting` state → الزر `disabled` + `aria-busy`،
  و`if (submitting) return` في أول `onSubmit` (حرس ضد الإرسال بـEnter)،
  و`AbortController` واحد.

---

## 5. تحديد المعدّل (مناسب لـVercel Hobby)

مفيش Redis، مفيش خدمة خارجية جديدة، مفيش جدول عدّادات. **٤ طبقات رخيصة:**

| الطبقة | المكان | الحد | طبيعتها |
|---|---|---|---|
| L0 — حجم ونوع | الراوت، قبل أي قراءة | `Content-Type: application/json` فقط؛ الـbody ≤ **١٦ ك.ب**؛ الأصناف ≤ ٢٠ | قاطعة |
| L1 — جدار Vercel | إعداد المشروع، مش كود | قاعدة على `/api/orders` | قاطعة (لو الخطة بتسمح) |
| L2 — نافذة منزلقة لكل IP | ذاكرة العملية (`Map` على مستوى الموديول) | ١٠ طلبات / ١٠ دقايق | **أفضل جهد** |
| L3 — حد يومي لكل موبايل | `order_phone_window_count` جوه المعاملة | ٥ طلبات / ٢٤ ساعة | قاطعة وموثوقة |

**صراحة عن L2:** الدوال بلا حالة ومتعددة النسخ — العدّاد في الذاكرة بيتصفّر مع كل
نسخة ومش مشترك. فهو بيوقف الضغط المتكرر من مستخدم واحد، و**مش** بيوقف هجوم موزّع.
الطبقة القاطعة الحقيقية هي **L3**. مكتوب كده صريح، مش مخفي.

تفاصيل L2: `Map<string, number[]>`، المفتاح أول قطعة من `x-forwarded-for`، تنضيف
الطوابع القديمة عند كل قراءة، سقف ٥٠٠٠ مفتاح (عند الامتلاء يتصفّر الـMap — بسيط
ومتوقّع وما بيزوّدش الذاكرة).

الرد: 429 + الرسالة العربية الثابتة. **مفيش `Retry-After`** ومفيش عدّادات في الرد.

---

## 6. الوصول للإيصال

### 6.1 الرابط

`/order/FLM-XXXXXX?t=<token>`

### 6.2 الرمز — HMAC محسوب، مش مخزّن

    payload = 'v1.' + orderNumber + '.' + expEpochSeconds
    sig     = base64url( HMAC-SHA256( ORDER_RECEIPT_SECRET, payload ) )
    token   = expEpochSeconds + '.' + sig

- `ORDER_RECEIPT_SECRET`: ≥ ٣٢ بايت عشوائية، متغير بيئة **سيرفر فقط**. ممنوع
  `NEXT_PUBLIC_`، ممنوع في `settings`، ممنوع في أي لوج.
- مفيش عمود ولا جدول ولا تنضيف — الرمز قابل للتحقق رياضياً.
- صلاحية **٧ أيام** (الإيصال تأكيد فوري، مش أرشيف). بعدها 404.
- التحقق بالترتيب: `isValidOrderNumber` → `exp > now` → **مقارنة ثابتة الزمن**
  للتوقيع.
- بادئة `v1.` بتسمح بتدوير السرّ بقبول مزدوج مؤقت.

### 6.3 التسليم

1. الرد على `POST` بيرجّع `receiptPath` كامل.
2. الواجهة تخزّنه في `sessionStorage['zell-last-receipt']` ثم `router.replace(path)`.
3. الصفحة تقرا `t` من الـquery → تحديث الصفحة شغّال.

### 6.4 الصفحة — بدون أي قراءة واسعة للطلبات (ت٧)

- `app/order/[orderNumber]/page.tsx` — `export const dynamic = 'force-dynamic'`
  (ممنوع أي cache لصفحة فيها بيانات عميل).
- `robots: index: false, follow: false`.
- **القراءة بتمر على `order_receipt_projection(p_order_number)` حصراً** — مفيش
  `select` على `orders` من المتجر، لا بـ`service_role` ولا بغيره. التقنيع والإخفاء
  بيحصلوا في الداتابيز، فمفيش احتمال إن تعديل في الواجهة يكشف حقل زيادة.
- **ما يُعرض:** رقم الطلب، الحالة العامة للعميل بس، الإجماليات، الأصناف بأطوالها،
  المحافظة، الاسم الأول، آخر ٤ أرقام من الموبايل.
- **ما يُعرضش:** العنوان الكامل، `internal_notes`، `notify_error`، الحالة التشغيلية
  الداخلية، `idempotency_key`، `request_hash`.
- **رمز ناقص/مزوّر/منتهي أو طلب غير موجود → 404 واحدة بنفس الشكل بالظبط** (مش 403).
  403 بتأكّد إن رقم الطلب موجود = عدّاد تعداد مجاني للمهاجم.
- محتوى الصفحة: رقم الطلب كبير وقابل للنسخ، تنبيه «احتفظ برقم الطلب»، زر «ارجع
  للمتجر».

---

## 7. الإشعار

### 7.1 قاعدة ثابتة

**الإشعار ما يوقّعش الطلب أبداً.** بيتبعت **بعد** الـcommit و**بعد** ما الرد يروح
للعميل. أي فشل = `notify_error` بس.

### 7.2 التوقيت — `after()`

الطلب يلتزم → الرد يرجع فوراً → الإشعار جوه `after()` من `next/server` (Next 15):
- زمن الاستجابة مش معلّق على تليجرام.
- حد الـ١٠ ثواني لدوال Hobby مش مهدّد.
- فشل الإشعار مستحيل يأثّر على الرد.

### 7.3 الأساسي: تليجرام — متغيرات بيئة فقط (ت١)

- `POST https://api.telegram.org/bot<TOKEN>/sendMessage` بـ
  `AbortSignal.timeout(5000)`.
- `TELEGRAM_BOT_TOKEN` و`TELEGRAM_CHAT_ID` من `process.env` **فقط**.
- مفتاحَي `settings` (`telegram_bot_token`، `telegram_chat_id`) **ما يُقراوش من الكود
  الجديد إطلاقاً**، وبعد التشغيل تتعمل migration تنظيف بتحذف الصفّين. لحد وقتها
  يفضلوا فاضيين ومهملين.
- `parse_mode: 'HTML'` مع تهريب `& < >` في كل قيمة. نص الرسالة من منطق
  `backend/lib/notifyMessage.ts` منقول لـ`packages/core/src/notifyMessage.ts` كبنّاء
  نص صافي بدون أي اعتماد على منصّة.
- المحتوى: رقم الطلب، الاسم، الموبايل كامل (قناة المالك الخاصة)، المحافظة، العنوان،
  الأصناف بأطوالها، الإجمالي الفرعي والشحن والإجمالي، الملاحظات، وقت الطلب بتوقيت
  القاهرة.
- متغير ناقص = **مش خطأ**: `notify_error = 'TELEGRAM_NOT_CONFIGURED'` والطلب سليم.

### 7.4 `notify_email` — إعداد لوحة غير سرّي، وفاضي حالياً (ت٢)

- `notify_email` **مش سر** ويقدر يفضل في `settings` ويتعدّل من اللوحة. يفضل **بره**
  `PUBLIC_SETTING_KEYS` (الزبون مش محتاجه).
- **قيمته `""` على Production دلوقتي**، فالتعامل لازم يكون صريح:
  - الكود **ما يفترضش** إنه موجود. `trim()` فاضي → `NOTIFY_EMAIL_NOT_SET` مسجّل،
    والطلب سليم.
  - **ممنوع** فشل صامت: لو الإشعار الأساسي والاحتياطي الاتنين مش مظبوطين، ده يظهر
    كتحذير جاهزية في اللوحة (نفس نمط `ReadinessBadge` الموجود)، مش في اللوج بس.
  - `docs/OPERATIONS.md` تتضمن خطوة «اظبط إيميل الإشعارات» في قايمة ما قبل التشغيل.
- **الناقل** لسه قرار مفتوح (§11-ق١): `retoolEmail` في المسوّدات مش متاح على Vercel،
  ومفيش ناقل إيميل في الريبو. المقترح للمرحلة ١: تليجرام بس + `notify_error` + تحذير
  اللوحة، والإيميل في مرحلة تانية.

### 7.5 التسجيل

- نجاح: `update orders set notified_at = now(), notify_error = null,
  updated_at = now() where id = $1` — **`updated_at` صريح إلزامي (مفيش triggers)**.
- فشل: `update orders set notify_error = $1, updated_at = now() where id = $2` بكود
  قصير بدون PII، مقصوص على ٢٠٠ حرف: `TELEGRAM_HTTP_401`، `TELEGRAM_TIMEOUT`،
  `TELEGRAM_NOT_CONFIGURED`، `NOTIFY_EMAIL_NOT_SET`. **ممنوع** نص الاستثناء الخام —
  ممكن يحتوي الرابط وفيه التوكن.
- التحديث ده كتابة على `orders`، ودور `zell_order_writer` **ملوش `update`** بإصرار.
  فبيتم بمفتاح الباك إند خارج الـRPC. مقصود وموثّق.

### 7.6 اللوج

- **يُسجّل:** `orderNumber`، الكود الداخلي، مدة التنفيذ، أول قطعة من الـIP مهشّمة.
- **ما يُسجّلش أبداً:** الموبايل، الاسم، العنوان، الملاحظات، أي مفتاح أو توكن، الـbody
  الخام، رابط تليجرام كامل.
- أي خطأ غير متوقّع: `error.name` بس (نفس نمط `describeFailure` في
  `supabaseServer.ts`).

---

## 8. الملفات بالتحديد

### جديد

| الملف | الغرض |
|---|---|
| `packages/core/src/orders.ts` | العقود + `OrderErrorCode` + جدول الرسائل + `canonicalizeOrderRequest` |
| `packages/core/src/notifyMessage.ts` | بنّاء نص الإشعار (منقول من `backend/lib`، بدون منصّة) |
| `apps/storefront/app/api/orders/route.ts` | `POST /api/orders` — الحدود، التحقق، الهاش، RPC، الرد، `after()` |
| `apps/storefront/app/order/[orderNumber]/page.tsx` | صفحة الإيصال، `force-dynamic`، `noindex` |
| `apps/storefront/lib/data/receipt.ts` | توقيع/تحقق HMAC (`server-only`) |
| `apps/storefront/lib/data/orderRpc.ts` | `restRpc` — استدعاء PostgREST RPC (`server-only`) |
| `apps/storefront/lib/data/orderReceipt.ts` | استدعاء `order_receipt_projection` — **مفيش `select` على `orders`** |
| `apps/storefront/lib/rateLimit.ts` | نافذة L2 المنزلقة في الذاكرة |
| `apps/storefront/lib/notify/telegram.ts` | ناقل تليجرام (`server-only`) |
| `apps/storefront/lib/orderFlags.ts` | قراءة `ORDERS_ENABLED` (`server-only`) |
| `backend/db/migrations/0006a_order_number.sql` | §2.3 |
| `backend/db/migrations/0006b_order_idempotency.sql` | §2.3 |
| `backend/db/migrations/0006c_order_read_helpers.sql` | §2.5 |
| `backend/db/migrations/0006d_order_transaction.sql` | §2.6 |
| `docs/ORDER-FLOW.md` | وثيقة تشغيل: المتغيرات، الأكواد، التراجع، الفحص |

### معدّل

| الملف | التعديل |
|---|---|
| `packages/core/src/index.ts` | تصدير الوحدات الجديدة |
| `packages/core/src/pricing.ts` | **(ت٦)** شيل فرع الافتراضي من `computeShippingPiastres`؛ **(ت٣)** احترام المحافظات المقفولة؛ مطابقة ترتيب التقريب مع SQL |
| `packages/core/src/types.ts` | `StoreSettings.disabledGovernorates` |
| `apps/storefront/lib/data/mappers.ts` | **(ت٣)** ضم `shipping_disabled_governorates` لـ`PUBLIC_SETTING_KEYS` (غير سرّي) واستثناء المقفولة من `governorates` |
| `apps/storefront/lib/data/supabaseServer.ts` | `restGet` يقبل `'no-store'` |
| `apps/storefront/components/store/CheckoutForm.tsx` | إرسال حقيقي، `submitting`، منع الضغط المزدوج، عرض الخطأ من الكود، الحفاظ على السلة، `prop` اسمه `ordersEnabled` |
| `apps/storefront/app/checkout/page.tsx` | تمرير `ordersEnabled` من السيرفر |
| `apps/storefront/lib/cart.tsx` | مفيش تغيير منطقي — السلة تتنضّف **بعد** النجاح فقط |
| `apps/storefront/vercel.json` | `maxDuration` للراوت لو احتاج |
| `backend/db/migrations/0005a*`, `0005b*`, `0005c*` | **(ت٤)** رأس `SUPERSEDED — DO NOT RUN` + إشارة للمجموعة `0006*` |
| `README.md`، `docs/ARCHITECTURE.md`، `docs/OPERATIONS.md`، `docs/DATA-ACCESS.md` | مسار الطلب، المتغيرات الجديدة، وتوضيح «صفر قراءة واسعة للطلبات» |

### قرار مؤجّل

`backend/storefront/createOrder.ts`، `backend/lib/createOrderSql.ts`،
`backend/lib/orderNumber.ts`، `backend/lib/notifyMessage.ts`،
`backend/lib/notifyTransport.ts` — مكتوبة لمنفّذ Retool. تُحذف أو تُنقل
لـ`docs/legacy/` (§11-ق٥).

> **صفر لمسات** على `apps/admin/**` كله، `product_images`، رفع الصور، الأدوار،
> الإعدادات التشغيلية.

---

## 9. النشر والتراجع

### 9.1 بوّابة التشغيل

`ORDERS_ENABLED` — متغير بيئة **سيرفر** (ممنوع `NEXT_PUBLIC_`).
- غير مظبوط أو أي قيمة غير `true` = **مقفول**. غياب المتغير معناه مقفول، مش مفتوح.
- مقفول: الراوت يرجّع 503 `ORDERS_DISABLED` قبل أي قراءة، **و** صفحة الدفع تعرض نفس
  البانر الحالي والزر `disabled`.
- نفس الدرس من `ADMIN_MUTATIONS_ENABLED`: **ممنوع زر مفعّل مالوش وظيفة.** الزر
  ما يتفعّلش غير لما `ordersEnabled && !submitting && !invalid`.

### 9.2 الترتيب

| # | الخطوة | نشرات Vercel |
|---|---|---|
| 1 | **مراجعة الوثيقة دي والموافقة عليها** | ٠ |
| 2 | كتابة `0006a..0006d` من الصفر ومراجعتهم كـPR مستقل (**مش** تنفيذ المسوّدات القديمة — ت٤) | ٠ |
| 3 | تنفيذ `0006a`→`0006d` يدوي على Production بالترتيب، والتحقق بـ`select` إن الدوال والفهرس والدور موجودين وإن الدور **مالوش** `select` على `orders` | ٠ |
| 4 | PR كود واحد. CI أخضر. الـSHA يُبعت للمراجعة. **مفيش دمج بدون موافقة صريحة.** | ٠ |
| 5 | دمج squash. المتجر **ما بيتغيّرش** (`ORDERS_ENABLED` غير مظبوط) | ١ |
| 6 | ضبط `ORDERS_ENABLED=true` + `ORDER_RECEIPT_SECRET` + `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` على Vercel Production، و`notify_email` من اللوحة → **إعادة نشر إلزامية** (المتغيرات بتتضمّن وقت البناء) | ١ |
| 7 | فحص دخان: طلب حقيقي واحد → رقم الطلب، الإيصال، رسالة تليجرام، صف واحد في `orders` وصفوف `order_items`، `notified_at` مش null | ٠ |
| 8 | الطلب التجريبي: `status = 'cancelled'` + `internal_notes = 'طلب فحص تشغيل'` من اللوحة. **مش بيتحذف** — وجود صف حقيقي بيثبت إن قراءة اللوحة شغّالة | ٠ |

**نشرتين كفاية** (حصة Hobby). تحذير الخطوة ٦: المتغيرات لازمها **إعادة نشر**، مش بس حفظ.

### 9.3 التراجع

| المستوى | الإجراء | المدة | فقدان بيانات |
|---|---|---|---|
| فوري | شيل `ORDERS_ENABLED` + إعادة نشر | دقايق | لا |
| كود | `git revert` للـsquash commit + PR جديد | ساعة | لا |
| داتابيز | بالعكس: `drop function create_order` → التلات دوال القراءة → `drop index orders_idempotency_key_uidx` → `drop column request_hash, idempotency_key` → `drop function generate_order_number` → `drop role zell_order_writer` | دقايق | الطلبات تفضل؛ أعمدة الـidempotency بس هي اللي تضيع |

الأعمدة nullable والدور معزول، فالتراجع على الداتابيز **مش** بيمسح أي طلب. وأهم حاجة:
التراجع الفوري ما بيلمسش الداتابيز خالص.

---

## 10. مصفوفة الاختبار

مكان التنفيذ: `curl` على نشرة Preview بـ`ORDERS_ENABLED=true` على داتابيز منفصلة لو
أمكن (§11-ق٤)؛ وإلا على Production بعد الخطوة ٦ مع تنضيف يدوي.

| # | الحالة | الطريقة | المتوقّع |
|---|---|---|---|
| 1 | مسار سعيد | سلة بصنفين، بيانات سليمة | 201، `replayed: false`، صف واحد في `orders` + صفّين في `order_items`، الإجمالي = المعروض |
| 2 | **إعادة المحاولة** بنفس المفتاح ونفس البيانات | نفس `Idempotency-Key` ونفس الـbody مرتين | 200، `replayed: true`، **نفس رقم الطلب**، `count(orders) = 1` |
| 3 | إعادة المحاولة بعد خطأ شبكة | timeout من جهة العميل ثم إعادة بنفس المفتاح | طلب واحد بس في الداتابيز |
| 4 | نفس المفتاح ببيانات مختلفة | غيّر الطول في المحاولة التانية | 409 `IDEMPOTENCY_MISMATCH`، مفيش صف جديد |
| 5 | ترتيب الأصناف مختلف | نفس المفتاح، السلة معكوسة | 200 `replayed: true` (التطبيع شغّال) |
| 6 | مسافات زايدة في الاسم | نفس المفتاح، «  أحمد » ضد «أحمد» | 200 `replayed: true` |
| 7 | **إرسالين متزامنين نفس المفتاح** | طلبين بالتوازي | واحد 201 والتاني 200 `replayed`؛ `count = 1`. **لو ظهر 409 لازم يكون `CONCURRENT_SUBMIT`، وممنوع يكون `ITEM_UNAVAILABLE`** (ت٥) |
| 8 | إرسالين متزامنين بمفتاحين مختلفين | طلبين بالتوازي | طلبين، رقمين مختلفين |
| 9 | **سعر قديم** | تعديل السعر من اللوحة ثم إرسال من صفحة أقدم من ٥ دقايق | 201 بالسعر **الجديد** من الداتابيز؛ الإيصال يعرض الإجمالي الحقيقي |
| 10 | منتج اتقفل أثناء الدفع | `is_active = false` ثم إرسال | 409 `ITEM_UNAVAILABLE`، **صفر** صفوف في `orders` و`order_items` |
| 11 | **طول غير صالح** | أقل من `min`، أكبر من `max`، ومش مضاعف `step` (٣ حالات) | 409 `ITEM_UNAVAILABLE` في التلاتة، مفيش طلب ناقص |
| 12 | اسم/عنوان قصير | اسم حرفين، عنوان ٥ حروف | 400 `INVALID_NAME` / `INVALID_ADDRESS` |
| 13 | موبايل | `0123456789`، `+201012345678`، أرقام عربية | الأول 400، التاني والتالت ينجحوا بعد التطبيع |
| 14 | سلة فاضية / ٢١ صنف | — | 400 `CART_EMPTY` / `CART_TOO_LARGE` |
| 15 | JSON مشوّه / `items` مش array / `items: [1,2]` | — | 400 `BAD_JSON` / `CART_INVALID`، **مفيش 500** |
| 16 | body كبير | ٢٠٠ ك.ب | 413 `BODY_TOO_LARGE`، مفيش parse |
| 17 | `Content-Type` غلط | `text/plain` | 415 |
| 18 | محافظة غير مخدومة | اسم مش في `rates` | 400 `GOVERNORATE_NOT_SERVED` |
| 19 | **محافظة مقفولة — الواجهة (ت٣)** | ضيفها لـ`shipping_disabled_governorates` من اللوحة | **مش ظاهرة** في القائمة المنسدلة بعد انتهاء الـrevalidate |
| 19ب | **محافظة مقفولة — المعاملة (ت٣)** | `curl` مباشر بالمحافظة المقفولة، تخطّي الواجهة | 400 `GOVERNORATE_NOT_SERVED`، صفر صفوف |
| 20 | شحن مجاني | إجمالي ≥ العتبة | `shipping_piastres = 0` ومطابق للمعروض |
| 21 | **دلالة الافتراضي (ت٦)** | محافظة في `disabled` لكن موجودة في `rates`؛ ومحافظة مش في `rates` خالص | الاتنين مرفوضين. **ممنوع** أي طلب يتسعّر بـ`shipping_default_piastres` |
| 22 | إعدادات ناقصة | حذف مفتاح شحن مؤقتاً | 503 `SETTINGS_MISSING`، مفيش طلب ناقص |
| 23 | حد المعدّل لكل IP | ١٢ طلب في دقيقة | 429 بعد العاشر |
| 24 | الحد اليومي للموبايل | ٦ طلبات ناجحة لنفس الرقم | السادس 429 `PHONE_DAILY_LIMIT` |
| 25 | **إشعار غير مظبوط (ت١+ت٢)** | شيل متغيرات تليجرام و`notify_email` فاضي | **201 عادي**؛ `notify_error` فيه `TELEGRAM_NOT_CONFIGURED`؛ **تحذير جاهزية ظاهر في اللوحة** مش في اللوج بس |
| 26 | **فشل الإشعار** | توكن تليجرام غلط | 201 عادي، `notified_at` null، `notify_error = 'TELEGRAM_HTTP_401'`، مفيش PII ولا توكن في النص |
| 27 | مهلة الإشعار | تأخير > ٥ ثواني | 201 ورد سريع، `notify_error = 'TELEGRAM_TIMEOUT'` |
| 28 | **وصول غير مصرّح للإيصال** | `/order/FLM-ABC234` بدون `t` | 404 |
| 29 | رمز مزوّر | تعديل حرف في التوقيع | 404 (نفس الشكل) |
| 30 | رمز لطلب تاني | رمز صحيح لرقم طلب مختلف | 404 |
| 31 | رمز منتهي | `exp` في الماضي | 404 |
| 32 | رقم طلب غير موجود برمز صحيح الشكل | — | 404، **نفس** شكل الحالة ٢٨ بالظبط |
| 33 | تعداد | ٥٠ رقم طلب عشوائي | ٥٠ × 404، زمن استجابة متقارب |
| 34 | **إسقاط الإيصال (ت٧)** | فحص رد `order_receipt_projection` الخام | **مفيش** عنوان كامل، ولا `internal_notes`، ولا `notify_error`، ولا `idempotency_key`، ولا `request_hash` |
| 35 | **صفر قراءة واسعة (ت٧)** | `has_table_privilege('zell_order_writer','public.orders','select')` | `false` |
| 36 | البوّابة مقفولة | شيل `ORDERS_ENABLED` | 503 `ORDERS_DISABLED` + الزر `disabled` + البانر ظاهر |
| 37 | **السلة محفوظة عند الفشل** | أي خطأ من ١٠–٢٢ | السلة زي ما هي، البيانات في الحقول زي ما هي، الخطأ ظاهر جنب الزر |
| 38 | السلة تتنضّف عند النجاح بس | مسار سعيد | السلة فاضية **بعد** الوصول للإيصال |
| 39 | ضغط مزدوج سريع | دوبل كليك + Enter | طلب شبكة واحد بس |
| 40 | تحديث الصفحة أثناء الإرسال | F5 وسط الطلب | إعادة إرسال بنفس المفتاح من `sessionStorage` → replay، طلب واحد |
| 41 | **فحص تسريب (ت١)** | مراجعة لوجات Vercel + كل ردود الأخطاء + `notify_error` | مفيش موبايل/عنوان/اسم/مفتاح/توكن، ومفيش رسالة استثناء خام |
| 42 | `updated_at` | بعد تسجيل الإشعار | `updated_at > created_at` (التحديث الصريح شغّال) |
| 43 | اللوحة تقرا الطلب | صفحة الطلبات في الأدمن | الطلب ظاهر بالأصناف والإجماليات صح |

---

## 11. التوجيهات المعتمدة والأسئلة المتبقية

### 11.1 معتمد ومقفول

ت١ حتى ت٧ في §0.4 **قرارات مُقرّة**. مش محتاجة إعادة نقاش في مراجعة الكود، وأي
انحراف عنها يُرفض في المراجعة.

### 11.2 لسه محتاج قرارك

| # | السؤال | المقترح |
|---|---|---|
| **ق١** | ناقل الإيميل الاحتياطي: تليجرام بس في المرحلة ١، أو Resend بمفتاح جديد؟ | تليجرام بس + تحذير جاهزية في اللوحة |
| **ق٢** | الحد اليومي لكل موبايل: ٥ طلبات / ٢٤ ساعة مناسب لحجم المتجر؟ | ٥ |
| **ق٣** | صلاحية رمز الإيصال ٧ أيام مناسبة؟ | ٧ أيام |
| **ق٤** | الاختبار: على Production مع تنضيف يدوي، أو مشروع Supabase منفصل للتجارب؟ (بيأثّر على مصداقية الحالات ١٠، ١٩، ٢١، ٢٢، ٢٤) | مشروع منفصل لو ممكن |
| **ق٥** | مسوّدات Retool في `backend/`: تتحذف، أو تتنقل لـ`docs/legacy/`؟ | `docs/legacy/` مع رأس «مرجع تاريخي — لا تُنفّذ» |
| **ق٦** | عرض العنوان في الإيصال: مخفي (مقترحي) أو كامل؟ | مخفي |
| **ق٧** | اسم الدور `zell_order_writer` بدل `zell_definer` — موافق؟ | موافق (الاسم القديم بقى مضلّل بعد شيل القراءة) |

---

## ملحق — مصادر الفحص

كل رقم وكل اسم عمود في الوثيقة دي مقروء من واحد من دول، مش مستنتج:

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
