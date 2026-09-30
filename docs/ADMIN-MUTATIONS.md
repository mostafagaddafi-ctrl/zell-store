# تعديلات لوحة التحكم — المرحلة د١

أول كتابة حقيقية من اللوحة على قاعدة البيانات.

**ADMIN_MUTATIONS_ENABLED لسه false.** كل الدوال اللي تحت بترجّع
DISABLED في التشغيل. الكود موجود للمراجعة مش للتنفيذ.

مفيش ربط واجهة في المرحلة دي — السيرفر بس.

---

## اللي اتعمل

| العملية | التزامن | الذرّية |
| --- | --- | --- |
| `saveProductAction` (إنشاء) | لا ينطبق | INSERT واحد |
| `saveProductAction` (تعديل) | `expectedUpdatedAt` إلزامي | PATCH واحد محمي |
| `setProductVisibilityAction` | `expectedUpdatedAt` إلزامي | PATCH واحد محمي |
| `setImageFitAction` | `expectedUpdatedAt` للصورة | PATCH واحد محمي |
| `setPrimaryImageAction` | أقفال في الداتابيز | `zell_set_primary_product_image` |
| `updateOrderStatusAction` | `expectedUpdatedAt` للطلب | PATCH واحد محمي |
| `addOrderNoteAction` | `expectedUpdatedAt` للطلب | PATCH واحد محمي |

## اللي **ما اتعملش** ومستني RPC ذرّية

| العملية | الدالة المطلوبة | ليه ماينفعش دلوقتي |
| --- | --- | --- |
| `saveContentAction` | `zell_save_content` | GET-ثم-UPSERT مش ذرّي |
| `saveShippingAction` | `zell_save_shipping` | نفس السبب |
| `saveIdentityAction` | `zell_save_identity` | نفس السبب |
| `reorderProductsAction` | `zell_reorder_products` | عدة PATCH = ترتيب جزئي لو فشل |
| `reorderImagesAction` | `zell_reorder_product_images` | نفس السبب |

### تفصيل: ليه bulk upsert مش كفاية

`POST /settings` مع `Prefer: resolution=merge-duplicates` **ذرّي كعملية
كتابة** — كل المفاتيح بتتكتب في معاملة واحدة.

بس فحص النسخة **مش** جواها. التسلسل بيبقى:

    ١. GET أحدث updated_at للمفاتيح الستة
    ٢. قارن بالمتوقع
    ٣. UPSERT

بين ٢ و ٣ يقدر أدمن تاني يحفظ، وحفظه يتمسح من غير أي تعارض يظهر.
الفحص لازم يكون **جوه** نفس المعاملة — يعني جوه دالة داتابيز.

نفس المنطق للترتيب: PostgREST مالوش bulk PATCH بقيم مختلفة لكل صف،
و bulk upsert ماينفعش لأن `products.name_ar` عمود `NOT NULL` من غير
default، و `ON CONFLICT DO UPDATE` بيبني صف الإدخال الأول فبيفشل.
والبديل — عدة PATCH متتالية — بيسيب ترتيب نصّه متكتب لو فشل في النص.

**ممنوع تقليد أي من الدوال الخمسة في TypeScript.**

## برّه النطاق

`deleteImageAction` · `resendNotificationAction` ·
`saveOperationalSettingsAction` · `revalidateStorefrontAction` ·
`uploadProductImagePlaceholder` · اللوجو · إدارة المستخدمين والأدوار.

---

## ترتيب الفحص في كل Action

    requireAdminAction()   ->  UNAUTHENTICATED | FORBIDDEN
    guardMutations()       ->  DISABLED
    تحقق المدخلات           ->  VALIDATION
    تزامن تفاؤلي            ->  CONFLICT | NOT_FOUND
    الكتابة

الصلاحية **قبل** علم التعديلات. العكس كان بيقول لمجهول إن "التعديلات
موقوفة" — وده تسريب معلومة عن حالة النظام لحد مش مفروض يعرف حاجة.

كل Action بتنادي `requireAdminAction()` بنفسها. مفيش اعتماد على
layout ولا على أي سياق مشترك.

---

## التزامن التفاؤلي — خمس خطوات

`patchGuarded` في `lib/mutations/concurrency.ts`:

    ١. اقرا updated_at الحالي من الداتابيز
    ٢. مفيش صف                       ->  NOT_FOUND
    ٣. قارنه بالمتوقع بدقة الميلي     ->  CONFLICT لو مختلف
    ٤. PATCH بفلتر updated_at = القيمة اللي إحنا قريناها
    ٥. صفر صفوف متأثرة               ->  CONFLICT

**ليه الخطوتين ٣ و ٤ مع بعض:**

الخطوة ٣ لوحدها مش ذرّية — في نافذة بينها وبين الكتابة.
الخطوة ٤ لوحدها مش دقيقة — Postgres بيخزّن ميكروثانية وJavaScript
بيقرا ميلي، فمقارنة نصية مباشرة بتدي **تعارض وهمي** لأي طابع عدّى
على الواجهة ورجع.

فالخطوة ٣ بتدي الدقة (`Date.parse` ومقارنة رقمية)، والخطوة ٤ بتدي
الذرّية (فلتر على القيمة اللي السيرفر قراها، **مش** اللي العميل بعتها).

**مفيش trigger على `updated_at` في أي جدول** — اتأكدت من `pg_trigger`.
فكل PATCH بيبعت `updated_at` بنفسه. من غير كده الطابع مابيتغيرش
والتزامن التفاؤلي بيبقى بلا معنى.

---

## الصورة الرئيسية

`zell_set_primary_product_image(p_product_id integer, p_image_id bigint)`
موجودة في Production و `EXECUTE` ممنوحة لـ `service_role`.

بتاخد `FOR UPDATE` على صور المنتج، بتنزّل الرئيسية القديمة لـ
`is_primary=false, fit='contain'`، بترفع الجديدة لـ
`is_primary=true, fit='cover'`، وبترجّع `updated_at` الجديد — أو
`null` لو الصورة مش من صور المنتج ده (`NOT_FOUND`).

**ليه دالة داتابيز مش كود:** في unique index جزئي
`product_images_one_primary_idx ... where is_primary` بيرفض أي لحظة
فيها رئيسيتين. تعديلين متتاليين من الكود كانوا هيفشلوا على الـ index،
والترتيب العكسي كان هيسيب المنتج بلا رئيسية لو فشل في النص.

مفيش `expectedUpdatedAt` هنا: الأقفال هي وسيلة التحكم في التزامن.

⚠️ الواجهة **لازم** تعيد قراءة المنتج كامل بعد النجاح. العملية بتغيّر
أكتر من صف، فتحديث حقل واحد محليًا بيعرض حالة غلط.

---

## حدود التحقق

مطابقة لقيود الداتابيز عن قصد، عشان الرفض ييجي برسالة عربية من
التطبيق مش برسالة قيد من Postgres ماينفعش تتعرض.

| الحقل | الحد | القيد المقابل |
| --- | --- | --- |
| `nameAr` | مقصوص · ٢–١٢٠ | `name_ar NOT NULL` |
| `nameEn` | اختياري · ≤ ١٦٠ | — |
| `brand` | اختياري · ≤ ١٠٠ | — |
| `descriptionAr` | اختياري · ≤ ٢٠٠٠ | — |
| `shortBenefit` | اختياري · ≤ ١٨٠ | — |
| `benefits` | ٠–٦ عناصر · كل واحد ≤ ١٤٠ · مفيش فاضي | `products_benefits_shape` |
| كل الأسعار والمقاسات | أعداد صحيحة منتهية | — |
| `pricePerMeterPiastres` | > ٠ | `products_price_per_meter_check` |
| `widthCm` · `minLengthCm` · `stepCm` | > ٠ | `products_min_length_cm_check` |
| `maxLengthCm` | ≥ `minLengthCm` | `products_max_length_cm_check` |
| `sortOrder` | ≥ ٠ | — |
| `status` | واحد من الخمسة | `orders_status_check` |
| `internalNotes` | ≤ ٢٠٠٠ | `orders_internal_notes_length` |
| `fit` | `cover` أو `contain` | `product_images_fit_check` |

**ممنوع القص الصامت.** أي قيمة برّه الحد بترفض `VALIDATION`، ومابتتعدّلش
لتبقى صالحة. النصوص الاختيارية الفاضية بتتحوّل `null` مش نص فاضي.

`expectedUpdatedAt` الناقص أو غير الصالح بيرفض `VALIDATION` —
**مابيسمحش** بكتابة من غير تحقق.

---

## الأعمدة المسموح الكتابة فيها

طبقة الكتابة **مش** CRUD عام. أسماء الجداول والدوال ثوابت مكتوبة في
`lib/mutations/*`، وكل اسم بيتفحص بنمط `^[a-z][a-z0-9_]*$` قبل ما
يدخل في URL. مفيش مسار بياخد اسم جدول ولا عمود من مدخلات المستخدم.

`products`: ١٣ عمود من `ProductColumns` بس.

⚠️ `image_url` · `images` · `before_image` · `after_image` **مستثنيين
عن قصد** — دول أعمدة نظام الصور القديم، و `product_images` هو المعتمد.
الكتابة فيهم كانت هتخلي مصدرين للصور بيختلفوا.

`orders`: `status` و `internal_notes` بس.
`product_images`: `fit` بس (والرئيسية عن طريق الـ RPC).

---

## الأخطاء

| الكود | معناه |
| --- | --- |
| `UNAUTHENTICATED` | مفيش جلسة |
| `FORBIDDEN` | جلسة بلا صف مفعّل في `admin_users` |
| `DISABLED` | العلم false — الحالة الحالية لكل العمليات |
| `VALIDATION` | مدخل مرفوض، برسالة عربية واضحة |
| `NOT_FOUND` | السجل مش موجود، أو الصورة مش من صور المنتج |
| `CONFLICT` | حد تاني عدّل السجل |
| `INTERNAL` | أي استثناء غير متوقع |

**`INTERNAL` نص ثابت واحد.** `toInternalFailure` في
`lib/mutations/errors.ts` بتتجاهل الاستثناء عن قصد — أي تفصيلة من
Supabase (اسم عمود، اسم قيد، جزء من استعلام) ممنوعة تخرج للعميل.
وطبقة النقل بترمي بالحالة بس، من غير جسم الرد.

---

## تصحيح قراءتين

`internalNotes` و `shipping.disabled` كان مكتوب في `adminData.ts` إنهم
مش موجودين في الداتابيز. **الاتنين موجودين فعلًا** وطبقة القراءة كانت
بتقراهم صح من الأصل — التعليقات بس كانت قديمة. اتشالت.

واتضاف `updatedAt` لـ `AdminOrderDetail` (وعمود `updated_at` لأعمدة
قراءة الطلب)، لأن تعديل الحالة والملاحظات محتاجه للتزامن التفاؤلي.

---

## دورة حياة المنتج

### الإنشاء بيبدأ مخفي — إجباريًا

المنتج الجديد بيتولد `is_active = false` دايمًا. قيمة `isActive` الجاية
من الواجهة **بتتجاهل تمامًا** وقت الإنشاء (`validateProduct(input, 'create')`).

السبب: المنتج وقت الإنشاء مالوش صور، ومش بالضرورة وصف مكتمل. لو
الواجهة بعتت `isActive: true` كان هينشر منتج ناقص في المتجر فورًا.

التفعيل عملية **منفصلة** بشروطها.

### شروط التفعيل

قبل أي كتابة تخلي `is_active = true`:

| الشرط | مصدر الفحص |
| --- | --- |
| `description_ar` مش فاضي | — |
| `short_benefit` مش فاضي | — |
| صورة `gallery` رئيسية واحدة بالظبط | `product_images` |

أي شرط ناقص بيرجّع `VALIDATION` برسالة عربية بتسمّي الناقص، والإظهار
**مابيتغيرش**.

### مسارين بيقدروا يفعّلوا — والاتنين محميين

| المسار | النصوص بتتفحص من | الصورة |
| --- | --- | --- |
| `setProductVisibility(true)` | المخزّن | المخزّن |
| `saveProduct` بـ `is_active = true` | **الحفظة الجاية** | المخزّن |

الفرق مقصود: نفس الحفظة ممكن تكون هي اللي بتكمّل الوصف والفايدة
المختصرة، ففحص المخزّن كان هيرفض حفظة صحيحة. الصورة بتتقرا من
المخزّن في الحالتين لأنها مش جزء من حفظ المنتج.

⚠️ من غير الفحص في `saveProduct` كان ينفع **تتخطى شروط الجاهزية
بالكامل** بحفظ عادي فيه `is_active = true` — الفحص في
`setProductVisibility` لوحده مش كفاية.

### الإخفاء مالوش شروط

`setProductVisibility(false)` مابيفحصش أي جاهزية. إخفاء منتج ناقص أو
غلط لازم يفضل ممكن في أي وقت — أي شرط عليه كان هيحبس منتج غلط ظاهر
للزبون.

### ⚠️ القاعدة دي في التطبيق بس

مفيش قيد في الداتابيز بيمنع `is_active = true` على منتج ناقص. يعني:

- أي مسار كتابة جديد على `products` لازم يمر من `activationReadiness`
- الكتابة المباشرة على الداتابيز (SQL أو لوحة Supabase) **بتتخطى
  القاعدة بالكامل**

لو القاعدة دي أصبحت حرجة، مكانها الصح قيد أو trigger في الداتابيز.
