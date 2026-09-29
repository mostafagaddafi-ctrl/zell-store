# نقاط المراجعة قبل تنفيذ 0004 — بيانات مؤكّدة من production

كل الأرقام تحت من استعلامات **قراءة فقط** على production بتاريخ 2026-09-29.
الملفات `0003` و`0004` **لم تُنفّذ** ومحفوظة للمراجعة.

---

## ١) المالك الفعلي (owner)

| الكائن | النوع | المالك |
| --- | --- | --- |
| `products`, `orders`, `order_items`, `settings` | table | `postgres` |
| `products_id_seq`, `orders_id_seq`, `order_items_id_seq` | sequence | `postgres` |

**لكن** `pg_default_acl` فيه صفّين: واحد بمالك `postgres` وواحد بمالك `supabase_admin`.
الصفّ الثاني بيسري على أي كائن ينشئه `supabase_admin` (أدوات Supabase الداخلية أو
عمليات الاستعادة/النسخ). عشان كده `0004` بيعالج **الاتنين** — لو عالجنا `postgres` بس
هيفضل فيه مسار بيعيد فتح الصلاحيات.

سمات الأدوار المؤكدة:

| الدور | superuser | bypassrls | login |
| --- | --- | --- | --- |
| `postgres` | ❌ | ✅ | ✅ |
| `service_role` | ❌ | ✅ | ❌ |
| `anon` | ❌ | ❌ | ❌ |
| `authenticated` | ❌ | ❌ | ❌ |
| `supabase_admin` | ✅ | ✅ | ✅ |

> ملاحظة: `service_role` و`anon` و`authenticated` كلهم `NOLOGIN` — الوصول بيتم
> عن طريق PostgREST اللي بيعمل `set role` بعد التحقق من الـ JWT.

---

## ٢) تأثير 0004 على `service_role` — **صفر**

`0004` بيسحب من `anon` و`authenticated` **فقط**. لا يمسّ `service_role` ولا `postgres`.

الوضع الحالي لـ `service_role` (وهيفضل زي ما هو بعد 0004):

| الكائن | الصلاحيات |
| --- | --- |
| الجداول الأربعة | `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` |
| الـ sequences الثلاثة | `USAGE` |
| الصلاحيات الافتراضية للجداول/الدوال/الـ sequences الجديدة | تفضل ممنوحة لـ `service_role` |

كمان `service_role` عنده `rolbypassrls = true`، يعني RLS ما بيأثرش عليه أصلاً.
الاستخدام المقصود له محصور في: **مورد Retool / الباك إند فقط** (رفع الصور على Storage)،
وممنوع يظهر في الواجهة أو في أي استجابة API.

**نقطة للمراجعة**: هل نسيب الصلاحيات الافتراضية مفتوحة لـ `service_role`؟
- **الإبقاء** (المقترح في 0004 الحالي): أبسط، وأي جدول جديد يشتغل فوراً مع Storage/الأدوات.
- **السحب أيضاً**: أكثر تشدداً، لكنه بيتطلب `grant` صريح مع كل كائن جديد، وممكن
  يكسر أدوات Supabase المدارة. **التوصية: نسيبه** ونعتمد على عدم تسريب المفتاح.

---

## ٣) الـ default EXECUTE على الدوال — مهم قبل `create_order`

الوضع الحالي المؤكد:

```
pg_default_acl (public, objtype = f):
  owner=postgres        → postgres=X | anon=X | authenticated=X | service_role=X
  owner=supabase_admin  → postgres=X | anon=X | authenticated=X | service_role=X
```

يعني **أي دالة جديدة تتعمل دلوقتي بتبقى قابلة للتنفيذ من `anon` تلقائياً**.
ده خطير تحديداً مع `create_order` لأننا بنخطط تكون `SECURITY DEFINER`
(بتشتغل بصلاحيات المالك = `postgres`)، فالنتيجة: أي حد معاه المفتاح العام
يقدر ينشئ طلبات بلا حدود — spam وبيانات وهمية، حتى والجداول مقفولة.

**الترتيب الصحيح المتفق عليه:**

1. تنفيذ `0004` أولاً (يمنع EXECUTE الافتراضي لـ `anon`/`authenticated`).
2. بعدها إنشاء `create_order` في migration منفصلة، وفيها بشكل صريح:

```sql
create function public.create_order(...) returns jsonb
language plpgsql
security definer
set search_path = ''                      -- إلزامي: فاضي تماماً، مش 'public, pg_temp'
as $$ ... $$;                             -- وكل المراجع schema-qualified: public.orders …

revoke all on function public.create_order(...) from public, anon, authenticated;
-- المنح يتم لاحقاً ولدور محدد فقط، وقت ما نفتح المتجر للعامة:
-- grant execute on function public.create_order(...) to zell_order;
```

**ليه `search_path = ''` ومش `public, pg_temp`؟**
مع `public, pg_temp` لسه فيه احتمال إن كائن في `public` (أو جدول مؤقت) يغطّي على المقصود
لو اتعمل بنفس الاسم. مع `''` مفيش أي بحث ضمني خالص (ماعدا `pg_catalog` اللي بيفضل
موجود دائماً للدوال والمعاملات المدمجة)، فأي مرجع غير مؤهّل بيفشل وقت التنفيذ بدل
ما يروح لكائن غلط — يعني الخطأ بيبان في المراجعة مش في الإنتاج.

3. أي منح لـ `anon` يتأجل لقرار منفصل، ويتعمل معاه rate limiting على مستوى التطبيق.

> ملاحظة إضافية: `revoke ... from public` مهمة كمان — الدوال في PostgreSQL بتتمنح
> لـ `PUBLIC` افتراضياً بغض النظر عن default ACL بتاع Supabase.

---

## الخلاصة للمراجعة

- ✅ المالك الفعلي = `postgres` لكل الكائنات، ومع ذلك لازم نعالج `supabase_admin` في default ACL.
- ✅ `0004` لا يؤثر على `service_role` إطلاقاً (مسحوب من anon/authenticated فقط).
- ⚠️ `0004` **شرط مسبق** لإنشاء `create_order`، وإلا الدالة هتبقى متاحة لـ `anon` تلقائياً.
