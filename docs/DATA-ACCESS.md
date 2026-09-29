# طبقة الوصول للبيانات — مين بيقرا إيه وبأي مفتاح

وثيقة مرجعية بعد تشغيل RLS وسحب صلاحيات `anon` (migration `0002`).

---

## 1) الوضع الحالي داخل Retool

```
متصفح الزبون
   │  (نداء داخلي على نفس الأصل — CSP: connect-src 'self')
   ▼
دالة Backend في Retool  ──►  مورد Postgres (SUPABASE)  ──►  قاعدة البيانات
                               دور postgres (BYPASSRLS)
```

- **الواجهة ما بتلمسش قاعدة البيانات ولا Supabase API إطلاقاً.** بتنادي دوال الباك إند بس.
- مفيش anon key ولا service_role ولا أي سر في كود الواجهة أو في المتصفح.
- عشان كده سحب صلاحيات `anon` **ما أثّرش على المتجر**: إحنا أصلاً مش بنستخدم PostREST.
- التطبيق نفسه مقفول على أعضاء الـ org (حماية Retool)، مفيش وصول عام.

### سطح الوصول المسموح (الدوال هي الحدود الأمنية)

| الدالة | تقرا | تكتب | ملاحظات |
| --- | --- | --- | --- |
| `storefront/getStorefront` | المنتجات **النشطة فقط** + إعدادات محدّدة بالاسم | — | مفيش `select *` على `settings`؛ المفاتيح بتترجع واحد واحد |
| `storefront/createOrder` | المنتجات + إعدادات الشحن | `orders`, `order_items` | عبارة SQL واحدة ذرّية، الأسعار من الداتابيز، أي رقم من الواجهة بيتجاهل |
| `admin/*` | كل شيء | المنتجات والإعدادات وحالة الطلب | لوحة التحكم — محمية بدخول Retool |

> **قاعدة**: أي استعلام جديد يتكتب كدالة محدّدة الغرض. ممنوع دالة عامة تاخد SQL أو
> اسم جدول من الواجهة، وممنوع أي «storage proxy» عام يمرّر مسارات من العميل.

---

## 2) الوضع بعد ما المتجر يبقى عام (خارج Retool) — التصميم المقترح

المشكلة: لما الواجهة تبقى عامة، مفيش «backend Retool» يحميها، فلازم نحدد
مين بيقرا المنتجات العامة وبأي صلاحية.

### الخيار (أ) — الوصول من السيرفر بدور محدود الصلاحيات ✅ الموصى به

نعمل دورين جديدين بدل ما نستخدم `postgres` أو `service_role`:

```sql
-- قراءة عامة: المنتجات النشطة والإعدادات المسموح نشرها فقط
create role zell_read login password '...';
grant usage on schema public to zell_read;
grant select on public.products to zell_read;           -- + RLS policy تحت
grant select on public.public_settings to zell_read;    -- VIEW فيها المفاتيح العامة بس

-- كتابة الطلبات: عن طريق دالة واحدة SECURITY DEFINER، من غير INSERT مباشر
create role zell_order login password '...';
grant usage on schema public to zell_order;
grant execute on function public.create_order(jsonb, text, text, text, text, text) to zell_order;
```

مع policies:

```sql
create policy products_public_read on public.products
  for select to zell_read using (is_active = true);
```

و VIEW للإعدادات العامة (عشان `telegram_bot_token` و`notify_email` ما يتسربوش):

```sql
create view public.public_settings as
  select key, value from public.settings
  where key in ('store_name','logo_url','offer_text','whatsapp_number',
                'whatsapp_message','shipping_rates','shipping_default_piastres',
                'free_shipping_threshold_piastres','testimonials','gallery','materials');
```

وإنشاء الطلب يتحوّل من «عبارة SQL في التطبيق» إلى **دالة `create_order` بـ SECURITY DEFINER**
فيها نفس المنطق الذرّي — كده الويب سيرفر ما عندوش صلاحية INSERT مباشرة على `orders` أصلاً.

- `postgres` و`service_role`: **مايستخدموش من التطبيق نهائياً** — صيانة وmigrations بس.
- الأسرار تفضل في متغيّرات بيئة على السيرفر، ولا تتسرب للمتصفح.

### الخيار (ب) — PostgREST مع RLS صارم (لو حبينا نداء مباشر من المتصفح)

```sql
grant select on public.products to anon;
create policy products_anon_read on public.products
  for select to anon using (is_active = true);
grant select on public.public_settings to anon;
-- الطلبات: ممنوع INSERT مباشر. RPC بس:
grant execute on function public.create_order(...) to anon;
```

- `orders` و`order_items` و`settings` تفضل **مقفولة تماماً** على `anon`.
- عيبه: أي تغيير غلط في policy بيتحوّل فوراً لتسريب بيانات، والمراجعة بتبقى أصعب.
  لو اخترناه، لازم اختبارات تتأكد إن `select` على `orders` بالـ anon key بيرجع خطأ.

---

## 3) الصور و Storage

- الصور في bucket `product-images` (قراءة عامة) — الرابط العام `.../object/public/...`
  ما بيحتاجش أي مفتاح، فالمتصفح بيعرضها عادي.
- **الرفع من السيرفر فقط**: مورد REST في Retool بيحمل `service_role` كهيدر،
  والواجهة بتبعت الملف للباك إند، والباك إند هو اللي بيرفع.
- **ممنوع**: تمرير `service_role` للواجهة، أو عمل endpoint عام يقبل أي مسار/عملية Storage.
  الدالة بتبني المسار بنفسها: `products/{product_id}/{uuid}.{ext}` وبتتحقق من نوع
  الملف وحجمه قبل الرفع.
- في قاعدة البيانات بنخزّن **object path** فقط (جدول `product_images`) — الرابط بيتركّب وقت العرض.
