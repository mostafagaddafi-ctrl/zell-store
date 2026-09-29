# Migrations — قاعدة بيانات ZELL

ترقيم تسلسلي، كل ملف يتنفّذ مرة واحدة وبالترتيب. كل migration مكتوبة بحيث تعيد التنفيذ
بأمان (idempotent) قدر الإمكان، ومعاها قسم rollback للتراجع اليدوي.

| الملف | الحالة | الوصف |
| --- | --- | --- |
| `../schema.sql` | **مطبّقة** | الأساس (baseline): `products`, `orders`, `order_items`, `settings` + الفهارس والبيانات المبدئية |
| `0002_security_rls_grants.sql` | **مطبّقة على production** بتاريخ 2026-09-29 | تشغيل RLS، سحب صلاحيات `anon`/`authenticated`، إنشاء bucket الصور |
| `0002_verification.md` | تقرير تحقق (2026-09-29) | مقارنة 0002 بالحالة الفعلية — **مطابق لكن ناقص**، وفيه الفجوات المكتشفة |
| `0003_product_images.sql` | **مقترحة — لم تُنفّذ** | `product_images` + قيود: `sort_order >= 0`، الرئيسية لازم `kind='gallery'`، صيغة `checksum` sha256 hex |
| `0004_harden_default_privileges.sql` | **مقترحة — لم تُنفّذ** | إلغاء الصلاحيات الافتراضية لأي كائن جديد **بما فيها الدور الوهمي PUBLIC** + تنظيف الـ sequences والدوال |
| `0004_review_notes.md` | ملاحظات مراجعة | المالك الفعلي، تأثير 0004 على `service_role`، والـ default EXECUTE |
| `0005a_generate_order_number.sql` | **مسودة — لم تُنفّذ** | `generate_order_number()` (كانت اعتمادية مفقودة) |
| `0005b_order_idempotency.sql` | **مسودة — لم تُنفّذ** | أعمدة `idempotency_key` و`request_hash` + قيود الصيغة + الفهرس الفريد |
| `0005c_create_order_function.sql` | **مسودة — لم تُنفّذ** | `create_order` بـ `search_path = ''`، تحقق JSON آمن، إعادة محاولة عند تصادم الرقم |
| `0005_role_model.md` | ملاحظات | نموذج الأدوار وحدود حماية `zell_definer` |
| `0006_site_images.sql` | **مقترحة — لم تُنفّذ** | `site_images` (logo/gallery/material) + `storage_orphans` + قيود الترتيب والتفرّد |

> ترتيب ملزم: **0004 ← 0005a ← 0005b ← 0005c**.
> بدون 0004 الدوال الجديدة قابلة للتنفيذ من `PUBLIC` (كل الأدوار) تلقائياً.

> **0002 مش مصدر الحقيقة الوحيد**: هو توثيق لتعديل نُفّذ قبل كتابته.
> المرجع هو ناتج استعلامات التحقق في `0002_verification.md` — تتعاد قبل أي إطلاق.

## المؤجّل بوعي

- **تحديد المعدل المتقدم** (بصمة HMAC + نافذة): **مش في الداتابيز**. أي `raise exception`
  بيعمل rollback فبيلغي تحديث العدّاد، يعني المحاولات المرفوضة مش بتتعد. مكانه الصح
  الباك إند/الحافة، خارج الـ transaction. (كان في مسودة 0005 القديمة واتشال.)
- **حساب الهاش في الداتابيز**: اتشال. `pg_catalog.sha256` مش مضمونة، وpgcrypto في
  schema `extensions` — الباك إند بيحسب SHA-256 ويمرره، والداتابيز تتحقق من الصيغة.

## طريقة التنفيذ

Supabase Dashboard ← SQL Editor ← الصق محتوى الملف ← Run.
(أو `psql "$DATABASE_URL" -f backend/db/migrations/0003_product_images.sql`)

## قواعد متفق عليها

- **ممنوع** تنفيذ أي تغيير على production من غير migration مكتوبة ومراجَعة.
- **ممنوع** حذف أعمدة أو بيانات في نفس الـ migration اللي بتضيف البديل.
- كل منح صلاحيات لازم يسبقه `revoke ... from public` — المحرّك بيمنح لـ PUBLIC تلقائياً.
- `service_role` و`postgres` يفضلوا في مورد Retool/الباك إند فقط.
