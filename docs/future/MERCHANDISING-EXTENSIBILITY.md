# ⚠️ تصميم مستقبلي — منفّذ جزئيًا

> **الحالة دلوقتي:**
>
> | الجزء | الحالة |
> | --- | --- |
> | الأقسام | ✅ **اتعملت بشكل مختلف** — جدول `collections` + `product_collections` (المنتج ممكن يبقى في أكتر من قسم)، مش `categories` + `category_id`. راجع `docs/COLLECTIONS.md` |
> | شريط الإعلان | ✅ **اتعمل أبسط** — مفتاح واحد `settings.announcement` (نص · رابط · تشغيل)، مش جدول |
> | إعلانات متعددة بمواعيد وأنواع | ❌ مش منفّذ — جدول `announcements` تحت |
> | عروض رول متعددة لكل منتج | ✅ **0015** — `product_widths` (كل عرض بسعر المتر بتاعه) |
> | البيع بالقطعة + الإضافات | ✅ **0016** — `products.sale_unit` + `order_items.sale_unit/quantity` + `product_addons` (مش `pricing_model` بأربع قيم) |
> | المتر المربع · المقاسات الثابتة | ❌ مش منفّذ — `square_meter` و`product_size_variants` |
>
> أرقام الـ migrations اللي تحت (0007–0013) **اتستخدمت لحاجات تانية** على
> Production. أي تنفيذ جديد ياخد أرقام بعد آخر migration موجودة.
>
> لسه **صفر طلبات**، فتغيير شكل `order_items` لسه رخيص — بس ده هيتغيّر أول
> ما الطلبات الحقيقية تبدأ.

---

# مرونة العرض التجاري: الأقسام · الإعلانات · نماذج التسعير

الهدف: النظام يبقى **متجر قابل للتوسع**، مش متجر أفلام زجاج بس.

التصميم اتبنى على فحص فعلي للسكيما والكود عند `76e2e62`.

---

## اللي اتأكد قبل التصميم

| الحقيقة | النتيجة |
| --- | --- |
| `ProductRules = { price_per_meter_piastres, min_length_cm, step_cm, max_length_cm }` و `StoreProduct = ProductRules & {…}` | المتر الطولي مدفون في **نظام الأنواع** مش في الواجهة بس |
| `zell_create_order` بتحسب `round(price_per_meter_piastres * length_cm / 100)` ثابت | تسعير الطلب **أعمى عن النموذج في الداتابيز** |
| `order_items.length_cm` و `width_cm` `NOT NULL CHECK > 0` | صنف بيتباع بالقطعة **ماينفعش يتخزّن** حاليًا |
| `products.price_per_meter_piastres` `NOT NULL`، و `width_cm`/`min`/`step`/`max` `NOT NULL` بقيم افتراضية | منتج غير خطي هيحمل `width_cm = 50` بالصدفة |
| **صفر طلبات** | شكل الـ snapshot ينفع يتغيّر دلوقتي بتكلفة صفر |

---

## ⚠️ مشكلة في الترتيب المقترح

الترتيب المطلوب كان: إنشاء الطلب أولًا، ونماذج التسعير ثالثًا.
**الترتيب ده بيكلّف إعادة كتابة.**

`zell_create_order` دالة `security definer` ليها دور `zell_definer`
وgrants وسياسات RLS خاصة. لو اتعملت بتسعير خطي بس، إضافة
`square_meter` معناها **إعادة كتابة الدالة الوحيدة اللي بتلمس الفلوس**،
وإعادة الموافقة على كل البنية الأمنية بتاعتها — بعد ما الطلبات الحقيقية
تبدأ تدخل منها.

وأسوأ: أي طلب بيدخل في الفترة دي بياخد snapshot **ماينفعش هيكليًا** يمثّل
بيع بالمتر المربع أو بالقطعة. الطلبات التاريخية تبقى غير قابلة للترحيل.

**التوصية: خلي عقد الطلب واعي بالنموذج من الخطوة الأولى، ونفّذ
`linear_meter` بس.**

يعني `zell_create_order` بتتفرّع على `pricing_model` من أول يوم، وتلات
فروع بترجّع "نموذج غير مدعوم". و`order_items` بتاخد أعمدتها العامة فورًا.
بعد كده إضافة نموذج بتلمس فرع، **مش** السطح الأمني للدالة ولا شكل الـ
snapshot.

---

## ١) السكيما والـ migrations

ستة migrations، كل واحد يتراجع لوحده. **نص + `CHECK`، مش enum** — نفس
العرف الموجود (`status` و `kind` و `fit` كلهم كده)، وبيتجنّب `ALTER TYPE`.

### `0007_categories.sql`

    categories
      id             serial pk
      name_ar        text not null       check (btrim(name_ar) <> '')
      slug           text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
      description_ar text
      bucket         text                -- صورة القسم، اختيارية
      object_path    text
      is_active      boolean not null default false   -- الجديد مخفي
      sort_order     integer not null default 0 check (sort_order >= 0)
      seo_title      text   check (seo_title is null or char_length(seo_title) <= 160)
      created_at     timestamptz not null default now()
      updated_at     timestamptz not null default now()
      unique (bucket, object_path)

RLS مفعّل، صفر policies، `service_role` بس — نفس وضع `admin_users`.

### `0008_products_category.sql`

    alter table products add column category_id integer
      references categories(id) on delete restrict;

    insert into categories (name_ar, slug, is_active, sort_order)
      values ('أفلام الزجاج','window-films',true,1);

    update products set category_id =
      (select id from categories where slug='window-films');

    alter table products alter column category_id set not null;

**`ON DELETE RESTRICT` بيطبّق "ممنوع حذف قسم فيه منتجات" في الداتابيز**،
مش في التطبيق بس. مقارنة بقاعدة جاهزية تفعيل المنتج اللي مطبّقة بالكود بس
وبالتالي ممكن تتخطى بـ SQL — دي لأ.

### `0009_pricing_model.sql`

    alter table products
      add column pricing_model text not null default 'linear_meter'
        check (pricing_model in ('linear_meter','square_meter','unit','fixed_size')),
      add column unit_label text,
      add column price_per_sqm_piastres  integer check (price_per_sqm_piastres  is null or price_per_sqm_piastres  > 0),
      add column price_per_unit_piastres integer check (price_per_unit_piastres is null or price_per_unit_piastres > 0),
      add column min_area_sqcm integer check (min_area_sqcm is null or min_area_sqcm > 0),
      add column max_area_sqcm integer check (max_area_sqcm is null or max_area_sqcm > 0);

المساحات **بالسنتيمتر المربع كأعداد صحيحة** — حفاظًا على قاعدة "مفيش
كسور عائمة". ١ متر مربع = ١٠٠٠٠ سم².

### `0010_pricing_model_constraints.sql`

تخفيف قيود `NOT NULL` الخطية، وإعادة فرضها **لكل نموذج** — فالتحقق بيبقى
**أقوى** مش أضعف:

    alter table products
      alter column price_per_meter_piastres drop not null,
      alter column width_cm       drop not null,
      alter column min_length_cm  drop not null,
      alter column step_cm        drop not null,
      alter column max_length_cm  drop not null;

    alter table products add constraint products_pricing_model_fields check (
      case pricing_model
        when 'linear_meter' then
          price_per_meter_piastres is not null and width_cm is not null
          and min_length_cm is not null and step_cm is not null
          and max_length_cm is not null and max_length_cm >= min_length_cm
        when 'square_meter' then price_per_sqm_piastres is not null
        when 'unit'         then price_per_unit_piastres is not null
        when 'fixed_size'   then true
      end
    );

### `0011_order_items_model.sql`

    alter table order_items
      add column pricing_model text not null default 'linear_meter'
        check (pricing_model in ('linear_meter','square_meter','unit','fixed_size')),
      add column unit_label text,
      add column quantity integer not null default 1 check (quantity > 0),
      add column area_sqcm integer check (area_sqcm is null or area_sqcm > 0),
      add column size_variant_label text,
      alter column length_cm drop not null,
      alter column width_cm  drop not null;

    alter table order_items drop constraint order_items_length_cm_check;
    alter table order_items drop constraint order_items_width_cm_check;

    alter table order_items add constraint order_items_dimensions check (
      (length_cm is null or length_cm > 0) and (width_cm is null or width_cm > 0)
    );

    alter table order_items add constraint order_items_model_fields check (
      case pricing_model
        when 'linear_meter' then length_cm is not null and width_cm is not null
        when 'square_meter' then area_sqcm is not null
        when 'unit'         then true
        when 'fixed_size'   then size_variant_label is not null
      end
    );

### `0012_size_variants.sql` — `fixed_size` بس هو اللي محتاج جدول ابن

    product_size_variants
      id             bigserial pk
      product_id     integer not null references products(id) on delete cascade
      label_ar       text not null
      width_cm       integer not null check (width_cm > 0)
      length_cm      integer not null check (length_cm > 0)
      price_piastres integer not null check (price_piastres > 0)
      is_active      boolean not null default true
      sort_order     integer not null default 0
      created_at / updated_at
      unique (product_id, label_ar)

تلات نماذج بتتسع في أعمدة؛ `fixed_size` علاقة واحد-لمتعدد بطبيعته.

### `0013_announcements.sql`

    announcements
      id         serial pk
      text_ar    text not null check (btrim(text_ar) <> '' and char_length(text_ar) <= 200)
      href       text          -- داخلي أو https بس
      tone       text not null default 'info' check (tone in ('info','promotion','warning'))
      is_active  boolean not null default false
      sort_order integer not null default 0 check (sort_order >= 0)
      start_at   timestamptz
      end_at     timestamptz
      created_at / updated_at
      check (end_at is null or start_at is null or end_at > start_at)

---

## ⚠️ فين "إضافة فقط" ماتقدرش تتحقق

القاعدة كانت: إضافة فقط، من غير حذف لحقول التسعير القديمة.
**مفيش عمود بيتشال ومفيش بيانات بتتفقد** — لكن **٧ قيود `NOT NULL` لازم
تتخفّف** (٥ على `products` و ٢ على `order_items`)، وقيدين `CHECK` على
`order_items` بيتبدلوا بنسخ واعية بالنموذج.

البديل هو كتابة قيم بلا معنى — لوح بيتباع بالقطعة يتسجّل `width_cm = 50`
و `length_cm = 1`. ده **بيانات بتكدب**، وأي تقرير مبني عليها غلط.

وللمنتجات الخطية القيود الجديدة **مطابقة أو أصرم** (بقت بتتأكد كمان إن
`max >= min`، وده عمود القيود ماكانش بيعمله). ومع **صفر طلبات** مفيش
بيانات تاريخية في خطر.

🔸 **محتاج موافقة صريحة على التخفيف ده قبل كتابة أي migration.**

---

## ٢) استراتيجية التوافق

| | |
| --- | --- |
| المنتجات الأربعة | backfill على `window-films` و `pricing_model='linear_meter'` (القيمة الافتراضية) |
| الطلبات الموجودة | مفيش — الافتراضي + الـ backfill بيخلي الترحيل no-op |
| `packages/core` | `ProductRules` **ما يتغيّرش**؛ يتضاف `LinearMeterPricing`/`SquareMeterPricing`/`UnitPricing`/`FixedSizePricing` و `StoreProduct` يبقى discriminated union على `pricing_model` |
| `computeSubtotalPiastres` | يفضل زي ما هو، ويبقى فرع `linear_meter` من `computeLinePiastres()` |
| `backend/lib/pricing.ts` و `frontend/lib/core/pricing.ts` | **ما تتلمسش** — مرجع تاريخي، وتفضل خطية |
| `offer_text` | **ما يتحذفش.** قيمته الحالية تتزرع كأول إعلان، والمفتاح يفضل مقروء |

⚠️ المتجر بيقرا الإعلانات؛ **ولو مفيش إعلان نشط مايعرضش حاجة** —
**مابيرجعش** لـ `offer_text`. السقوط الصامت على بيانات قديمة ممنوع.

---

## ٣) تغييرات المتجر

| المسار | التغيير |
| --- | --- |
| `/` | أقسام ظاهرة ومرتّبة؛ المنتجات متجمّعة |
| `/category/[slug]` | **جديد** — 404 لقسم مخفي أو غير معروف |
| `/product/[productId]` | المحدّد بيتغيّر حسب `pricing_model` |
| `/cart` · `/checkout` | العرض من حقول الـ snapshot، مش من طول مفترض |

مكوّنات جديدة: `AnnouncementBar` (فوق `SiteHeader`) · `CategoryNav` ·
`CategoryGrid`، وأربع محدّدات: `LinearMeterPicker` (`SizePicker` الحالي
بعد إعادة تسمية) · `AreaPicker` · `QuantityPicker` · `SizeVariantPicker`.

⚠️ `CartLine` بيتغيّر من `{ productId, lengthCm }` لاختيار موسوم بالنموذج.
**ده بيبطّل السلات الموجودة في localStorage** — محتاج مفتاح إصدار عشان
السلة القديمة **تترمي** مش تتقرا غلط.

---

## ٤) تغييرات اللوحة

| المسار | الغرض |
| --- | --- |
| `/categories` | قائمة · عدد المنتجات · ترتيب · إظهار/إخفاء |
| `/categories/new` · `/categories/[id]` | محرّر + صورة |
| `/announcements` | قائمة · ترتيب · تشغيل · جدولة |
| `/announcements/new` · `/announcements/[id]` | محرّر |
| `/products/[id]` | محدّد القسم + لوحة تسعير حسب النموذج |

Actions جديدة، كلها بنفس النمط (`requireAdminAction` → العلم → تحقق →
تزامن تفاؤلي): `saveCategoryAction` · `setCategoryVisibilityAction` ·
`reorderCategoriesAction` · `saveAnnouncementAction` ·
`setAnnouncementVisibilityAction` · `reorderAnnouncementsAction` ·
`moveProductToCategoryAction`.

**الترتيبين محتاجين RPCs ذرّية** — `zell_reorder_categories` و
`zell_reorder_announcements` — حسب القاعدة إن أي كتابة على أكتر من صف
بتمر على الداتابيز.

حذف قسم **مش** إجراء في اللوحة في المرحلة دي: الإخفاء بدلًا منه.
`ON DELETE RESTRICT` بيمنع الحالة الخطرة أصلًا، والحذف-مع-إعادة-التعيين
قرار منفصل.

---

## ٥) عقود التسعير

كل الحساب بأعداد صحيحة. أرقام المتصفح للعرض؛ الداتابيز بتعيد الحساب.

| النموذج | الزبون بيختار | الحقول المطلوبة | إجمالي السطر |
| --- | --- | --- | --- |
| `linear_meter` | مقاس الشباك ← الطول المطلوب | `price_per_meter_piastres` · `width_cm` · `min/step/max_length_cm` | `round(price_per_meter × length_cm / 100)` |
| `square_meter` | عرض × ارتفاع ← مساحة | `price_per_sqm_piastres` · `min/max_area_sqcm` اختياري | `round(price_per_sqm × area_sqcm / 10000)` |
| `unit` | الكمية | `price_per_unit_piastres` | `price_per_unit × quantity` |
| `fixed_size` | مقاس + كمية | ≥١ مقاس نشط | `variant.price_piastres × quantity` |

الـ snapshot لكل نموذج:

| النموذج | الحقول اللي تتكتب في `order_items` |
| --- | --- |
| `linear_meter` | `length_cm` · `width_cm` · `unit_price_piastres` = سعر المتر |
| `square_meter` | `area_sqcm` · `length_cm` · `width_cm` · `unit_price_piastres` = سعر المتر المربع |
| `unit` | `quantity` · `unit_price_piastres` = سعر القطعة |
| `fixed_size` | `size_variant_label` · `length_cm` · `width_cm` · `quantity` · `unit_price_piastres` = سعر المقاس |

⚠️ `unit_price_piastres` **معناه بيتغيّر حسب النموذج** — وده بالظبط السبب
إن `pricing_model` و `unit_label` لازم يتسجّلوا جمبه. من غيرهم صف طلب قديم
**ماينفعش يتفسّر**.

**ممنوع نفترض إن القسم له نموذج تسعير واحد.** القسم ممكن يضم منتجات
بطرق بيع مختلفة.

---

## ٦) ترتيب التنفيذ والاختبارات

الترتيب الموصى به، مختلف عن المطلوب في الخطوة الأولى بس:

1. **إنشاء الطلب، واعي بالنموذج من البداية** — أعمدة `order_items`
   العامة، و`zell_create_order` بتتفرّع على `pricing_model`، و`linear_meter`
   بس هي المنفّذة
2. `categories` + backfill `category_id` (سكيما بس)
3. لوحة الأقسام
4. أقسام المتجر + `/category/[slug]`
5. `announcements` + اللوحة + الشريط
6. أعمدة `pricing_model` + union الأنواع في `@zell/core` (من غير تفعيل نموذج)
7. تنفيذ `square_meter` كامل
8. منتج "بديل الرخام" مخفي، اختبار، وبعدين تفعيل

الخطوات ٢–٥ مستقلة عن نماذج التسعير وتقدر تمشي بالتوازي مع ١.

### حالات الاختبار — كلها على بيانات مخفية الأول

- الترحيل no-op: الأربعة منتجات يفضلوا `linear_meter` / `window-films`،
  والأسعار والظهور ما يتغيروش
- `DELETE` على قسم فيه منتجات **يفشل في الداتابيز**
- قسم مخفي مايظهرش في المتجر، و slug بتاعه يرجّع 404
- منتج `pricing_model='square_meter'` و `price_per_sqm_piastres` null
  **يترفض من الـ CHECK**
- منتج خطي ناقص `step_cm` يترفض من نفس الـ CHECK (أصرم من الحالي)
- إعلان `start_at` في المستقبل مايظهرش · إعلان منتهي مايظهرش · صفر إعلانات
  نشطة = **مايظهر حاجة**
- رابط الإعلان يرفض `javascript:` و `//evil.com`، ويقبل `/` و `https://`
- سلة قديمة في localStorage من قبل التغيير **تترمي** مش تتقرا غلط
- طلب فيه أصناف بنماذج مختلفة يتسعّر صح في الداتابيز، وكل حقول النموذج
  تتسجّل
- التقريب: `price_per_sqm = 15000` و `area = 12345 cm²` — الداتابيز
  والواجهة يطابقوا للقرش

---

## أسئلة مفتوحة

1. موافقة على تخفيف **٧ قيود `NOT NULL`**؟
2. موافقة على نقل عقد الطلب الواعي بالنموذج للخطوة الأولى؟
3. صورة القسم: عمود على `categories` (المقترح) ولا `site_images` بـ
   `kind='category'`؟
