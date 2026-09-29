# Migrations — قاعدة بيانات ZELL

ترقيم تسلسلي، كل ملف يتنفّذ مرة واحدة وبالترتيب. كل migration مكتوبة بحيث تعيد التنفيذ
بأمان (idempotent) قدر الإمكان، ومعاها قسم rollback للتراجع اليدوي.

| الملف | الحالة | الوصف |
| --- | --- | --- |
| `../schema.sql` | **مطبّقة** | الأساس (baseline): `products`, `orders`, `order_items`, `settings` + الفهارس والبيانات المبدئية |
| `0002_security_rls_grants.sql` | **مطبّقة على production** بتاريخ 2026-09-29 | تشغيل RLS، سحب صلاحيات `anon`/`authenticated`، إنشاء bucket الصور |
| `0002_verification.md` | تقرير تحقق (2026-09-29) | مقارنة 0002 بالحالة الفعلية — **مطابق لكن ناقص**، وفيه الفجوات المكتشفة |
| `0003_product_images.sql` | **مقترحة — لم تُنفّذ** | جدول `product_images` (object path + ترتيب + صورة رئيسية) + قفل الجدول فوراً |
| `0004_harden_default_privileges.sql` | **مقترحة — لم تُنفّذ** | إلغاء الصلاحيات الافتراضية لأي كائن جديد + تنظيف الـ sequences |
| `0004_review_notes.md` | ملاحظات مراجعة | المالك الفعلي، تأثير 0004 على `service_role`، والـ default EXECUTE على الدوال |
| `0005_create_order_function.sql` | **مسودة — لم تُنفّذ** | `create_order` بـ `search_path = ''` + validation + rate limiting + idempotency |
| `0005_role_model.md` | ملاحظات | نموذج الأدوار وحدود حماية `zell_definer` |
| `0006_site_images.sql` | **مقترحة — لم تُنفّذ** | `site_images` (logo/gallery/material) + `storage_orphans` |

> ترتيب ملزم: **0004 قبل 0005**. وإلا الدالة هتبقى قابلة للتنفيذ من `anon` تلقائياً.

> **0002 مش مصدر الحقيقة الوحيد**: هو توثيق لتعديل نُفّذ قبل كتابته.
> المرجع هو ناتج استعلامات التحقق في `0002_verification.md` — تتعاد قبل أي إطلاق.

## طريقة التنفيذ

Supabase Dashboard ← SQL Editor ← الصق محتوى الملف ← Run.
(أو `psql "$DATABASE_URL" -f backend/db/migrations/0003_product_images.sql`)

## قواعد متفق عليها

- **ممنوع** تنفيذ أي تغيير على production من غير migration مكتوبة ومراجَعة.
- **ممنوع** حذف أعمدة أو بيانات في نفس الـ migration اللي بتضيف البديل — الحذف يبقى في
  migration لاحقة منفصلة بعد فترة تشغيل آمنة.
- `service_role` و`postgres` يفضلوا في مورد Retool/الباك إند فقط — **لا يظهروا في الواجهة أبداً**.
