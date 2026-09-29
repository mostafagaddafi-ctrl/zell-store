# تحقّق من مطابقة 0002 للحالة الفعلية على production

تاريخ التحقق: 2026-09-29 — استعلامات **قراءة فقط**، مفيش أي تعديل.

## ١) البنود اللي ادّعاها 0002 — كلها مطابقة ✅

| البند | المتوقع | الفعلي |
| --- | --- | --- |
| RLS على `products`, `orders`, `order_items`, `settings` | مفعّل | `rowsecurity = true` للأربعة ✅ |
| policies | مفيش | صفر policies في `public` و`storage` ✅ |
| صلاحيات `anon` / `authenticated` على الجداول | مسحوبة | صفر صفوف في `role_table_grants` ✅ |
| bucket `product-images` | عام، 5 MB، صور فقط | `public=true`, `file_size_limit=5242880`, `image/jpeg,image/png,image/webp,image/avif` ✅ |
| محتويات الـ bucket | فاضي | 0 objects ✅ |

## ٢) فجوات **مش** مغطّاة في 0002 (مكتشفة أثناء التحقق)

### 🔴 حرجة — الصلاحيات الافتراضية تعيد فتح الباب مع أي جدول جديد

```
pg_default_acl (schema=public, owner=postgres | supabase_admin):
  tables    → anon=arwdDxtm, authenticated=arwdDxtm     (كل الصلاحيات)
  sequences → anon=rwU,       authenticated=rwU
  functions → anon=X,         authenticated=X
```

يعني **أي جدول جديد** يتعمل في `public` بيتمنح لـ `anon` تلقائياً كل الصلاحيات.
لو نفّذنا `0003_product_images.sql` بصيغته الأولى، الجدول الجديد كان هيبقى مكشوف
على Supabase REST API فوراً. لذلك:

- تم تعديل `0003` ليشمل `revoke` + `enable row level security` للجدول والـ sequence بتاعه.
- وأُضيفت `0004_harden_default_privileges.sql` (مقترحة) لمعالجة الجذر مرة واحدة.

### 🟠 متوسطة — صلاحية USAGE على الـ sequences لسه قائمة

```
orders_id_seq, products_id_seq, order_items_id_seq → USAGE لـ anon و authenticated
```

مش كافية لقراءة بيانات (الجداول نفسها مقفولة)، لكنها بتسرّب عدّاد الطلبات
(`select last_value`) — يعني منافس يقدر يعرف عدد طلباتك. تتعالج في `0004`.

### 🟡 معلوماتية — مقبولة ومقصودة

- `USAGE` على schema `public` و`storage` لـ `anon`/`authenticated`: افتراضي في Supabase
  وغير كافٍ وحده للوصول لأي بيانات بعد سحب صلاحيات الجداول.
- RLS مفعّل لكن **من غير** `FORCE`: مقصود — دور `postgres` (المالك، `rolbypassrls=true`)
  لازم يفضل قادر يقرا ويكتب من الباك إند.
- مفيش views ولا دوال في `public` حتى الآن (الاستعلامات كلها من التطبيق).

## ٣) الخلاصة

`0002` **يطابق** ما هو منفّذ فعلاً، لكنه **لا يكفي** كضمان أمني بمفرده.
الحالة الآمنة الكاملة تحتاج `0004`، ولا يجوز اعتبار `0002` مصدر الحقيقة الوحيد —
المرجع هو ناتج استعلامات التحقق أدناه.

## ٤) استعلامات التحقق (شغّلها في Supabase SQL Editor)

```sql
-- RLS
select tablename, rowsecurity from pg_tables where schemaname='public';

-- صلاحيات الأدوار العامة على الجداول (المفروض صفر صفوف)
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated');

-- الصلاحيات الافتراضية للجداول الجديدة (المفروض تبقى فاضية بعد 0004)
select n.nspname, pg_get_userbyid(d.defaclrole) as owner, d.defaclobjtype,
       array_to_string(d.defaclacl,' | ') as acl
from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace
where n.nspname='public';

-- الـ sequences
select object_name, grantee, privilege_type from information_schema.usage_privileges
where object_schema='public' and grantee in ('anon','authenticated');

-- الـ bucket
select id, public, file_size_limit, allowed_mime_types from storage.buckets;
```
