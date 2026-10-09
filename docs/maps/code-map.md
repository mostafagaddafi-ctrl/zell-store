# خريطة الكود

كل فولدر في `apps/` و`packages/`: بيعمل إيه. الهدف إن أي شات يعرف يفتح أنهي ملف من غير ما يقرا الريبو كله.

- **الحدود:** `docs/ARCHITECTURE.md`. المتجر مابيكتبش في الداتابيز غير من مسار الطلب، واللوحة مابتستوردش من المتجر والعكس، و`packages/core` مفيهوش I/O.
- **الداتابيز:** `docs/maps/db-map.md` · **الملفات الكبيرة:** `docs/maps/big-files.md`.
- أي PR بيضيف فولدر أو بيغيّر شغل فولدر **يحدّث الملف ده في نفس الـ PR.**

---

## apps/admin — لوحة التحكم (Next.js على Vercel، محمية بـ Supabase Auth)

| الفولدر | بيعمل إيه |
| --- | --- |
| `apps/admin/` (الجذر) | الإعدادات: `middleware.ts` (حماية المسارات وتجديد الجلسة) · `next.config.mjs` · `vercel.json` · `tailwind.config.ts` · `.env.example` (أسماء المتغيرات بس) |
| `app/` | `layout.tsx` و`globals.css` |
| `app/(auth)/login` | صفحة الدخول. `actions.ts` = خطوتين: `signInWithPassword` وبعدين صف مفعّل في `admin_users`، وإلا `signOut` فورًا |
| `app/(auth)/403` | حساب داخل بس مالوش صف مفعّل في `admin_users` |
| `app/(dashboard)` | `layout.tsx` (الإطار) و`page.tsx` (الرئيسية) |
| `app/(dashboard)/products` · `products/[id]` · `products/new` | قائمة المنتجات، والتعديل، ومنتج جديد |
| `app/(dashboard)/collections` · `[id]` · `new` | الأقسام |
| `app/(dashboard)/orders` · `orders/[orderNumber]` | الطلبات وتفاصيل الطلب |
| `app/(dashboard)/content` | محتوى المتجر وشريط الإعلان |
| `app/(dashboard)/identity` | الهوية والسوشيال وصور الموقع |
| `app/(dashboard)/shipping` | المحافظات والمناطق والأسعار |
| `app/(dashboard)/installation` · `installation-tools` | فني التركيب، وصفحة أدوات التركيب |
| `app/(dashboard)/coupons` | أكواد الخصم (المالك) |
| `app/(dashboard)/inventory/{suppliers,purchases,openings,lots}` | المخزون والمشتريات (0020): الموردين، ومستندات الشراء، وأول المدة، والـ lots |
| `app/(dashboard)/settings` | الإعدادات وحالة النظام |
| `app/api/admin/products/[productId]/images` · `site-images` · `collections/[id]/cover` | رفع الصور (route handlers) |
| `app/auth/signout` | الخروج (POST بس، و`GET` = 405) |
| `components/<المنطقة>` | واجهة كل قسم: `products` · `collections` · `orders` · `content` · `identity` · `shipping` · `installation` · `coupons` · `inventory` · `settings` |
| `components/shell` | الإطار: `AdminShell` · `PageHeader` · `SignOutButton` |
| `components/ui` | مكونات مشتركة: `Button` · `Field` · `Table` · `ConfirmDialog` · `SaveBar` · `FailureBanner` … |
| `lib/` (الجذر) | `actions.ts` (Server Actions) · `mutations.ts` (أنواع نتايج الكتابة) · `adminData.ts` · `systemHealth.ts` (حالة النظام) · `readiness.tsx` · `revalidateStorefront.ts` (بينادي `/api/revalidate` في المتجر) · `couponActions.ts` · `inventoryActions.ts` · `enums.ts` · `format.ts` · `collectionStatus.ts` · `cn.ts` |
| `lib/auth` | الهوية والحراس: `session.ts` (`readAdminRole`: الدور من `admin_users` بـ service_role) · `guards.ts` (`requireAdminPage` / `requireAdminAction`) · `supabaseServer.ts` · `supabaseMiddleware.ts` · `env.ts` · `nextPath.ts` |
| `lib/access` | 0021-P: الأغلفة المحمية (`wrappers.ts`)، وقرار الوصول لكل وضع legacy · shadow · enforce (`resolve.ts` · `mode.ts`)، وقايمة الـ 29 صلاحية (`capabilities.ts`)، وتفسير علم التعديلات (`flag.ts`)، وحالاتهم (`access.cases.ts`). `instance.ts` = الربط الحقيقي بالجلسة و`admin_users` و`zell_erp_*` (server-only). **من ب2 كل page و layout و route و action محمي متصدّر منه**، وجدول الربط `manifest.ts` (+ `manifest.cases.ts`: تكافؤ legacy لكل رمز) |
| `lib/data` | القراءة من PostgREST: `client.ts` · `reads.ts` · `rows.ts` · `inventoryEditor.ts`، وملف قراءة لكل منطقة بنفس اسم ملف الكتابة في `lib/mutations` (اتنقلوا بالحرف في 0021-P PR أ، وأنواعهم في ب1). `lib/data` مابيستوردش من `lib/mutations/**` |
| `lib/mutations` | كل الكتابة في الداتابيز، ملف لكل منطقة (منتجات · صور · أقسام · محتوى · شحن · تركيب · كوبونات · مخزون …)، ومعاهم `concurrency.ts` (التزامن التفاؤلي) و`errors.ts`. **الكتابة بس:** القراءة اتنقلت لـ `lib/data` |
| `lib/validation` | التحقق من المدخلات لكل منطقة |
| `lib/inventory` | منطق شاشات المخزون: النماذج والتسعير والتوزيع، و`rpc.ts` + `sessionCall.ts` (نداء `zell_inv_session_*` بجلسة المستخدم، 0020-S PR-2)، والرسايل، وحالات الاختبار (`*.cases.ts`) |
| `lib/orders` | 0021-A A2 — دورة الطلب: `cycle.ts` (منطق خالص: الانتقالات والبوابة · نتايج المكالمة · وقت القاهرة وفلاتر المتابعة · الموعد المؤكد والفترات · تعديل البيانات · وصف السجل · تحويل الأخطاء) + `orders.cases.ts`، و`rpc.ts` (نداء `zell_order_*` بجلسة المستخدم). الـ actions في `lib/orderActions.ts`، والقراءات في `lib/data/orderCycle.ts`، والكروت في `components/orders/OrderCycle.tsx` و`OrderTimeline.tsx` |
| `lib/coupons` | نموذج الكوبون وحالاته |
| `lib/client` | كود المتصفح: ضغط ورفع الصور، والـ hooks (`useSaveAction` · `usePreview` · `useInventoryIntent` · `useLineCards`) |
| `lib/uploads` | فحص حجم ونوع الصورة |
| `scripts/run-cases.mjs` | بيشغّل كل `*.cases.ts` (في CI: `ZELL_ADMIN_CASES_RESULT`) |
| `scripts/check-access.mjs` (+ `check-access.selftest.mjs`) | فاحص الحراس بالـ AST (0021-P): كل page/layout/route/action لازم يتصدّر من غلاف بصلاحية معروفة. `enforce` في CI من ب2 (أي finding = فشل) |
| `scripts/check-capabilities.mjs` | قايمة الصلاحيات في `lib/access/capabilities.ts` = catalog الداتابيز (المفتاح والفئة) |
| `scripts/check-access-manifest.mjs` | جدول الربط `lib/access/manifest.ts` = الكود: نفس الغلاف والصلاحية و`mutates` والرسالة لكل رمز من الـ 79، ومفيش رمز ناقص أو زيادة (0021-P ب2) |

## apps/storefront — المتجر (Next.js على Vercel، للزباين)

| الفولدر | بيعمل إيه |
| --- | --- |
| `apps/storefront/` (الجذر) | الإعدادات: `middleware.ts` (بيصدر كوكي جلسة الدفع على `/checkout`) · `next.config.mjs` · `vercel.json` · `.env.example` |
| `app/` | `page.tsx` (الرئيسية) · `layout.tsx` · `not-found.tsx` |
| `app/products` · `app/product/[productId]` | كل المنتجات، وصفحة المنتج |
| `app/collections` · `app/collection/[slug]` | الأقسام، وصفحة القسم |
| `app/cart` · `app/checkout` | السلة وإتمام الطلب |
| `app/order/[orderNumber]` | الإيصال (بكوكي `HttpOnly`) |
| `app/installation-tools` | صفحة أدوات التركيب |
| `app/api/orders` | إنشاء الطلب ← `zell_create_order` (مفتاح `ORDERS_ENABLED`) |
| `app/api/coupons/preview` | معاينة الكوبون ← `zell_preview_coupon` |
| `app/api/revalidate` | تحديث الكاش (بتناديه اللوحة بعد الحفظ) |
| `app/api/health` | فحص صحة |
| `components/store` | مكونات المتجر: الهيدر والفوتر، والهيرو، وكارت المنتج، والمقاس والعرض، والقطعة والإضافات، والسلة والدفع، والكوبون، وواتساب … |
| `components/ui` | مكونات مشتركة: `Button` · `Field` · `Container` · `ImageSlot` · `BackButton` |
| `lib/` (الجذر) | `cart.tsx` (السلة) · `catalog.ts` · `drafts.ts` · `productCopy.ts` · `useCheckoutCoupon.ts` · `cn.ts` |
| `lib/data` | القراءة: `queries.ts` · `mappers.ts` · `rpc.ts` · `source.ts` · `supabaseServer.ts` |
| `lib/orders` | مسار الطلب: `contracts.ts` · `canonical.ts` + `requestHash.ts` + `hash.ts` (idempotency) · `checkoutSession.ts` · `receiptToken.ts` · `requestGuards.ts` · `coupon*.ts` (+ حالات) · `notify.ts` (تليجرام) · `result.ts` · `errors.ts` |

## packages/core — منطق صافي مشترك (`@zell/core`)

| الملف | بيعمل إيه |
| --- | --- |
| `src/pricing.ts` | **التسعير — المرجع الوحيد** |
| `src/addons.ts` | الإضافات (القطعة) |
| `src/installation.ts` | حساب فني التركيب |
| `src/coupons.ts` (+ `coupons.cases.ts`) | حساب الكوبون |
| `src/orderNumber.ts` | شكل رقم الطلب |
| `src/images.ts` · `src/imageUrl.ts` | الصور وروابطها |
| `src/validation.ts` · `src/types.ts` · `src/index.ts` | التحقق والأنواع والتصدير |

---

## باقي الريبو

| المكان | بيعمل إيه |
| --- | --- |
| `backend/db/` | **شغّال:** `schema.sql` (الأساس) · `migrations/` · `ci/` (اختبارات SQL في CI). الخريطة: `docs/maps/db-map.md` |
| `backend/admin` · `backend/lib` · `backend/storefront` · `frontend/` | ⚠ **نسخة Retool القديمة، مرجع تاريخي بس.** مفيش حاجة في `apps/` بتستوردها ومفيش حاجة فيها بتشتغل. التسعير المعتمد في `packages/core/src/pricing.ts` وبس |
| `.github/workflows/ci.yml` | CI: install + typecheck + build + حالات اللوحة، وjob لـ 0021-P بيشتغل لما ملفاته تتغيّر |
| `scripts/vercel-ignore-build.sh` | خطوة Vercel «تخطّي البناء»: production بيتبني دايمًا، والمعاينة بتتخطّى مع `wip` أو `[skip deploy]` أو لو مسارات الفرع مالهاش علاقة بالتطبيق، وأي غموض = يبني |
| `docs/` | توثيق السيستم: العقود (`contracts/`)، والخرايط (`maps/`)، والخطط (`plans/`) |
| الجذر | `package.json` · `pnpm-workspace.yaml` · `tsconfig.base.json` · `README.md` (حالة النظام الحي) |
