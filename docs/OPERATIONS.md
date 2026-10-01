# التشغيل

Vercel و Supabase والمتغيرات والكاش وإدارة الأدمن.

الوثيقة دي بتوصف حالة النظام الحيّ وقت آخر تحديث ليها. لمعرفة النسخة
بالظبط، راجع تاريخ Git للملف ده.

> 🔒 **الوثيقة دي فيها أسماء متغيرات ونطاقاتها بس — ولا قيمة واحدة.**
> أي سر في ملف markdown هو تسريب.

---

## ١) Vercel

**مشروعين منفصلين على نفس الريبو.**

| | المتجر | اللوحة |
| --- | --- | --- |
| Root Directory | `apps/storefront` | `apps/admin` |
| Framework | Next.js | Next.js |
| Include files outside root | ☑️ **لازم مفعّلة** | ☑️ **لازم مفعّلة** |
| Build / Install | افتراضي | افتراضي |
| Node.js | **20.x** (نفس `ci.yml`) | **20.x** |
| Ignored Build Step | `bash scripts/vercel-ignore-build.sh storefront` | `bash scripts/vercel-ignore-build.sh admin` |
| الرابط | `zell-store-nine.vercel.app` | مضبوط في Vercel — مش مكرر هنا |

🔒 **رابط لوحة الإدارة مضبوط داخل Vercel ولا يُكرر عمدًا داخل مستودع**
**الكود.** هذا إجراء تنظيمي وليس حدًا أمنيًا؛ Supabase Auth وفحص الدور
على السيرفر هما الحماية الفعلية.

فايدة عملية كمان: الرابط لو اتغيّر، الوثيقة مابتقدمش ومابتضلّلش حد.

**"Include files outside root" إجبارية** — التطبيقين بيعتمدوا على
`@zell/core` بـ `workspace:*` وعلى `pnpm-lock.yaml` في الجذر.

### ⚠️ حصة النشر

الخطة الحالية Hobby. الحصة خلصت فعلًا مرة وقفلت النشر ٢٤ ساعة.
**مشروعين على نفس الريبو = بناءين لكل push.** اضبط Ignored Build Step
للاتنين، وقلّل الكوميتات.

### ⚠️ متغيرات Edge وقت البناء

الـ middleware في اللوحة بيشتغل على Edge، و Next بيثبّت قيم
`process.env` **وقت البناء** للـ Edge.

يعني لو اتضاف متغير **بعد** البناء: لوحة Vercel هتوريه موجود، والـ
middleware هيشوفه **فاضي**، وكل طلب هيروح `/login?error=unavailable` —
واللوحة تبان مكسورة بالكامل مع إن "كل حاجة متظبطة".

**القاعدة: أي تعديل على متغير لازم يتبعه Redeploy، مش حفظ وبس.**

ده **مش** ثغرة: الحراس على السيرفر بيقروا المتغيرات وقت التشغيل عادي،
والـ middleware أصلًا مش حدود الأمان.

---

## ٢) متغيرات البيئة — أسماء ونطاقات فقط

### المتجر

| المتغير | المكان | سري | ملاحظة |
| --- | --- | --- | --- |
| `STOREFRONT_DATA_SOURCE` | `apps/storefront/vercel.json` + CI | لا | `supabase` أو `fallback` — **مفيش افتراضي** |
| `SUPABASE_URL` | لوحة Vercel | لا | |
| `SUPABASE_READ_KEY` | لوحة Vercel | 🔒 نعم | |

### اللوحة

| المتغير | المكان | سري | ملاحظة |
| --- | --- | --- | --- |
| `SUPABASE_URL` | لوحة Vercel | لا | |
| `SUPABASE_ANON_KEY` | لوحة Vercel | لا، بس مايتعرضش | الهوية بس |
| `SUPABASE_SERVICE_ROLE_KEY` | لوحة Vercel | 🔒 نعم | ⚠️ انتقالي |
| `ADMIN_MUTATIONS_ENABLED` | لوحة Vercel | لا | **`true` حاليًا** |

### قواعد

1. **ممنوع تمامًا أي مفتاح يبقى `NEXT_PUBLIC_`.** مفيش عميل Supabase في
   المتصفح، فمفيش داعي.
2. الأسرار في لوحة Vercel بس. **ماتدخلش الريبو أبدًا.**
3. `ADMIN_MUTATIONS_ENABLED` غيابه = `false`. بس اكتبه صراحة.
4. `.env.local` متجاهَل في git؛ `apps/admin/.env.example` أسماء بس.

---

## ٣) Supabase

### الجداول

| الجدول | المحتوى |
| --- | --- |
| `products` | ٤ منتجات، كلها نشطة |
| `product_images` | صور المعرض — `bucket` + `object_path` |
| `orders` · `order_items` | **فاضيين** — إنشاء الطلب ما اتعملش |
| `settings` | ٢١ مفتاح: hero · sections · faqs · shipping_rates … |
| `site_images` | اللوجو |
| `storage_orphans` | ملفات محتاجة تنظيف — `insert_failed \| delete_failed \| replaced` |
| `admin_users` | `user_id` · `role` (owner \| admin) · `is_active` |

### الدوال

| الدالة | الغرض |
| --- | --- |
| `zell_save_content` | ٦ مفاتيح محتوى، فحص نسخة + كتابة ذرّية |
| `zell_save_shipping` | ٤ مفاتيح شحن |
| `zell_save_identity` | ٤ مفاتيح هوية (**من غير** `logo_url`) |
| `zell_reorder_products` | `sort_order` من **١** — كل المنتجات بما فيها المخفية |
| `zell_reorder_product_images` | `sort_order` من **٠** — `kind='gallery'` بس |
| `zell_set_primary_product_image` | أقفال `FOR UPDATE` |
| `zell_valid_benefits` | قيد `products_benefits_shape` |

كلها `security invoker`، و`EXECUTE` لـ `service_role` بس.

### RLS

RLS مفعّل على كل الجداول، و**صفر policies**. `anon` و `authenticated`
مالهمش أي وصول.

⚠️ **لكن `service_role` بيتخطى RLS بالكامل.** تطبيقات Vercel بتستخدم
وصول server-only بالمفتاح ده، فـ RLS **مش** اللي بيحدّها — اللي بيحدّها
كود التطبيق. ده السبب إن `requireAdminAction()` مكررة في كل Action
بدل ما تتحط في مكان واحد.

حل **انتقالي موثّق**. الهدف: أدوار محدودة وسياسات RLS حقيقية.

### Storage

| | |
| --- | --- |
| bucket | `product-images` |
| public | **true** |
| `file_size_limit` | `5242880` (٥ ميجا) |
| `allowed_mime_types` | `image/jpeg` · `image/png` · `image/webp` · `image/avif` |
| المسارات | `products/{id}/{uuid}.{ext}` · `branding/{uuid}.{ext}` |

الـ bucket بيطبّق الحد والأنواع **بنفسه** — خط دفاع مستقل عن كود التطبيق.

---

## ٤) إدارة الأدمن

مفيش واجهة لإدارة المستخدمين. كله من لوحة Supabase.

### إضافة أدمن

1. Authentication → Users → Add user (بريد + كلمة مرور، **Auto Confirm**)
2. انسخ الـ UUID
3. أضف صف في `admin_users`: `user_id` · `role` · `is_active = true`

### سحب الصلاحية

`is_active = false`. الجلسة الشغّالة بتروح `/403` في أول طلب جاي —
`resolveAdminIdentity` مش مخزّنة في كاش، فالسحب فوري.

### تدقيق

    select au.user_id, au.role, au.is_active, u.email, au.created_at
    from public.admin_users au
    join auth.users u on u.id = au.user_id
    order by au.created_at;

⚠️ **راجع النتيجة دي دوريًا.** كل صف `owner` نشط عنده وصول كامل لكل
بيانات المتجر. لو في صف مش متوقع، ده حادث أمني.

---

## ٥) الكاش

| | |
| --- | --- |
| المتجر | `REVALIDATE_SECONDS = 300` |
| اللوحة | مفيش كاش |
| التحديث عند الطلب | **ما اتعملش** |

تعديل من اللوحة بيظهر للزبون خلال ٥ دقايق كحد أقصى. للتحديث الفوري
دلوقتي: **إعادة نشر المتجر**. زرار «حدّث المتجر دلوقتي» في الإعدادات
**معطّل** لأن `revalidateStorefrontAction` ما اتعملش.

---

## ٦) علم الجاهزية

`ADMIN_MUTATIONS_ENABLED` هو المفتاح الوحيد اللي بيفتح الكتابة.

| القيمة | السلوك |
| --- | --- |
| `true` | الكتابة مفتوحة — **الحالة الحالية** |
| أي قيمة تانية أو غياب | كل Action بترجّع `DISABLED` وكل زرار معطّل |

المنطق: `(process.env['ADMIN_MUTATIONS_ENABLED'] ?? '').trim() === 'true'`

`ReadinessBadge` في ترويسة الإعدادات بيوري الحالة من الـ provider.

⚠️ العلم بيتكلم عن **الإذن**. `NotImplementedNotice` بيتكلم عن **الوجود**
ومابيختفيش مع فتح العلم — عشان الشاشات اللي ما اتعملتش ماتبانش شغّالة.

---

## ٧) التأكد بعد أي كتابة

### ملفات معلّقة محتاجة تنظيف

    select * from public.storage_orphans where cleaned_at is null;

**المتوقع: صفر صفوف.** أي صف معناه إن رفع فشل والتنظيف ما تمّش.

### اتساق الصور

    -- المفروض ترجّع صفر: منتج نشط بلا صورة رئيسية
    select p.id, p.name_ar
    from public.products p
    where p.is_active
      and not exists (
        select 1 from public.product_images pi
        where pi.product_id = p.id and pi.is_primary
      );

    -- المفروض ترجّع صفر: صف بيشاور على ملف مش موجود
    select pi.id, pi.object_path
    from public.product_images pi
    left join storage.objects o
      on o.bucket_id = pi.bucket and o.name = pi.object_path
    where o.name is null;

### أكتر من رئيسية لمنتج

مستحيل — `product_images_one_primary_idx` فهرس فريد جزئي. لو رجّع صفوف
يبقى الفهرس اتشال.
