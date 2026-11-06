# عقد COOKIES-HEADERS — كوكيز جلسة اللوحة + headers الأمان للتطبيقين

> **الحالة: مسودة للمراجعة — المالك وافق على كتابة العقد، ومفيش كود لسه.** الكود بيبدأ بعد قبول المراجع للعقد وأمر صريح من المالك، في PR لوحده.
> مبني على main `e5957b6` (#215). كل الحقايق من ملفات الريبو على الـ commit ده، ومن المصدر الرسمي لـ `@supabase/ssr` على GitHub عند الوسم `v0.5.2` (النسخة المثبّتة في `pnpm-lock.yaml`).

| | |
| --- | --- |
| المستوى | **الأول (PR + مراجع + موافقة المالك)**: بيمس تسجيل الدخول للوحة وheaders كل صفحات التطبيقين. |
| الموافقة | المالك في شات التنفيذ 2026-11-06: «موافق» على كتابة عقد الكوكيز والـ headers، بعد شرح التغيير. موافقة المراجع على العقد لسه مطلوبة، وبعدها أمر المالك ببدء الكود. |
| الممنوع | أي SQL أو migration · أي قراية أو كتابة للداتابيز · تغيير اسم كوكي الجلسة أو مسارها أو مدتها · تغيير طريقة الدخول أو الخروج أو الصلاحيات (`requireAdminPage` / `requireAdminAction`) · CSP كاملة (برّه النطاق، §٧) · كتابة رابط اللوحة الكامل في الريبو · أي قراية لـ Production (حتى الـ headers من الموقع) من غير موافقة لوحدها |

## ٠) المطلوب وليه
- **مراجعة أمنية من شات تاني (معلومة مش أمر):** كوكيز جلسة اللوحة مش `HttpOnly` ولا `Secure`، والتعليق في الكود بيقول عكس كده، ومفيش security headers.
- **المالك:** الدخول المحفوظ يفضل زي ما هو؛ المطلوب حماية «كارت الدخول» من إنه يتقري من جوه الصفحة أو يسافر على اتصال مش مشفّر، وتعليمات حماية للمتصفح.

## ١) الوضع النهارده (main `e5957b6`)
### ١-١ الكوكيز (اللوحة بس — المتجر مفيهوش دخول عملاء)
- مفيش عميل Supabase في المتصفح خالص في اللوحة (لا `createBrowserClient` ولا `document.cookie`؛ بحث في `apps/**`). الدخول Server Action (`app/(auth)/login/actions.ts`: `signInWithPassword`)، والخروج Route (`app/auth/signout/route.ts`)، والتجديد في الـ middleware.
- عميلين بيكتبوا كوكيز الجلسة، والاتنين بيمرّروا خيارات المكتبة زي ما هي:
  - `apps/admin/lib/auth/supabaseServer.ts` (`createAuthClient`): `store.set(cookie.name, cookie.value, cookie.options)`.
  - `apps/admin/lib/auth/supabaseMiddleware.ts` (`createMiddlewareClient`): `response.cookies.set(cookie.name, cookie.value, cookie.options)`.
  - و`apps/admin/middleware.ts` (`redirectWithCookies`) بينقل الكوكيز المجدّدة على رد التحويل بـ `redirectResponse.cookies.set(cookie)`.
- **المكتبة (`@supabase/ssr` 0.5.2، `src/utils/constants.ts`):** `DEFAULT_COOKIE_OPTIONS = { path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 * 24 * 60 * 60 }` ومفيش `secure`. وفي `src/cookies.ts` الخيارات اللي بتوصل لـ `setAll` = `{ ...DEFAULT_COOKIE_OPTIONS, ...options?.cookieOptions, ... }`. يعني النهارده الكوكي **مش HttpOnly ومش Secure**.
- التعليق في `supabaseServer.ts` («والكوكيز HttpOnly، فالمتصفح مايشوفش أي مفتاح ولا أي توكن») **مش مضمون من الكود**.
- عميل الـ re-auth المؤقت في حذف الطلبات (`lib/orders/purge.ts` `TEMP_AUTH_OPTIONS`: `persistSession: false`) مابيكتبش كوكيز، ومش داخل.
- كوكيز المتجر (رمز الإيصال: `app/api/orders/route.ts` و`middleware.ts`) **أصلًا** `httpOnly: true` و`secure` في الإنتاج و`sameSite: 'lax'`، ومش داخلة.

### ١-٢ الـ headers
- **من الكود بس:** مفيش headers أمان عامة في `next.config.mjs` لأي تطبيق، ولا في `vercel.json`. **ده مش معناه إن الرد الحقيقي فاضي**: Vercel ممكن يضيف headers (زي HSTS)، ومش معروف من غير قراية الموقع (§٥، بموافقة لوحدها).
- المتجر عنده rule واحدة: `/order/:orderNumber` ← `Cache-Control: private, no-store` و`Referrer-Policy: no-referrer` (صفحة الإيصال).
- مفيش CSP في أي مكان في الكود. Next بيحط CSP خاصة بيه على ردود تحسين الصور (`/_next/image`)؛ مش هنلمسها.
- مفيش `<iframe>` في كود التطبيقين، ومفيش استخدام للكاميرا أو المايك أو الموقع الجغرافي. فيه استخدام لـ `navigator.clipboard` (نسخ رقم الطلب في المتجر، ومحرّر الصفحات في اللوحة) — مش هيتقفل.

## ٢) الكوكيز — التصميم
- ملف واحد `apps/admin/lib/auth/cookieOptions.ts`: `ADMIN_AUTH_COOKIE_OPTIONS = { httpOnly: true, secure: <true في الإنتاج>, sameSite: 'lax', path: '/' }` (`secure` = `process.env.NODE_ENV === 'production'`، زي كوكيز المتجر). **من غير `name`** (عشان اسم الكوكي ومفتاح التخزين مايتغيّروش) و**من غير `maxAge`** (المدة تفضل افتراضي المكتبة 400 يوم، وحذف الكوكي بيفضل بـ `maxAge: 0` من المكتبة).
- بيتمرّر للمكتبة بالطريقة اللي هي بتدعمها: `createServerClient(url, anonKey, { cookieOptions: ADMIN_AUTH_COOKIE_OPTIONS, cookies: { … } })` في العميلين.
- **حماية زيادة في الكتابة:** في `setAll` بتاع العميلين، الخيارات اللي بتتكتب = `{ ...cookie.options, httpOnly: true, secure, sameSite: 'lax' }`، عشان لو نسخة مكتبة جاية غيّرت الدمج، الضمان يفضل في كودنا. الاسم والقيمة والمسار والمدة ماتتلمسش.
- `redirectWithCookies` بينقل الكوكي بخياراتها (`ResponseCookie` فيها الخيارات)؛ الاختبار بيثبت إن الخيارات بتوصل لرد التحويل.
- تصحيح التعليق في `supabaseServer.ts` عشان يحيل للملف الجديد.
- **الأثر على الجلسات الموجودة:** الحماية بتبدأ لما الكوكي يتكتب من جديد (دخول، أو تجديد التوكن في الـ middleware). **مش مضمون من دلوقتي إن مفيش خروج**؛ المتوقع إن الجلسة تفضل، والتأكيد بعد الاختبارات وتجربة المالك (§٦).

## ٣) الكوكيز — الاختبارات المطلوبة (الكوكيز المكتوبة فعليًا، مش قيمة الإعداد)
- suite جديدة في مشغّل حالات اللوحة بتشغّل **`@supabase/ssr` الحقيقية** (0.5.2) مع **`fetch` مزيّف** (مفيش شبكة ولا Supabase حقيقي) و**cookie store مزيّف** بيسجّل كل `set` بخياراته، ومن خلال **دوال الكتابة بتاعتنا نفسها** (الـ adapters اللي في العميلين، بتتفصل لدوال قابلة للاختبار من غير ما سلوكها يتغيّر).
- الحالات:
  - **C1 الدخول:** `signInWithPassword` ← كل كوكي جلسة اتكتب (`sb-<ref>-auth-token` أو أجزاؤه `.0`/`.1`) بـ `httpOnly: true` و`secure: true` (`NODE_ENV=production`) و`sameSite: 'lax'` و`path: '/'` و`maxAge` = 400 يوم، والاسم = اسم النهارده بالظبط.
  - **C2 التجديد:** جلسة منتهية + `getUser` ← التوكن الجديد اتكتب بنفس الخيارات ونفس الاسم، عن طريق عميل الـ middleware.
  - **C3 الخروج:** `signOut` ← كل أجزاء الكوكي اتمسحت (`maxAge: 0`) بنفس الاسم والمسار.
  - **C4 الأجزاء القديمة:** جلسة كبيرة (`.0` و`.1`) بعدها جلسة أصغر ← الجزء الزيادة اتمسح.
  - **C5 التحويل:** `redirectWithCookies` ← رد التحويل فيه نفس الكوكيز بنفس الخيارات (`httpOnly` و`secure` و`sameSite` و`path` و`maxAge`).
  - **C6 بيئة التطوير:** `NODE_ENV` مش production ← `secure: false` وباقي الخيارات زي ما هي.
  - **C7 الحماية الزيادة:** خيارات جاية من المكتبة فيها `httpOnly: false` ← اللي اتكتب `httpOnly: true`.
- **التشغيل:** مشغّل حالات اللوحة بيحوّل لمجلد مؤقت، فالـ suite دي محتاجة توصل لـ `@supabase/ssr` و`@supabase/supabase-js` و`next/server` من `node_modules` بتاع اللوحة (ربط من المجلد المؤقت، من غير dependency جديدة ولا تغيير في `pnpm-lock.yaml`). **لو ده طلع مش ممكن في CI:** شات التنفيذ بيبلّغ ويقترح بديل قبل ما يكمّل، ومايتنازلش لاختبار قيمة الإعداد بس من غير موافقة.

## ٤) الـ headers — التصميم
- في `next.config.mjs` للتطبيقين، rule عامة `source: '/:path*'` **قبل** أي rule موجودة:

| الـ header | القيمة | ليه |
| --- | --- | --- |
| `X-Frame-Options` | `DENY` | منع عرض الموقع جوه موقع تاني (خداع الضغط). **قرار مقصود:** مفيش iframe في الكود، بس ده مايثبتش إن مفيش طرف برّه بيعرض الموقع؛ بعد الدمج أي تضمين خارجي هيقف، وده المطلوب. |
| `X-Content-Type-Options` | `nosniff` | المتصفح مايخمّنش نوع الملف. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | الروابط الخارجية (واتساب وغيره) تاخد الدومين بس، مش المسار. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | قفل اللي مش مستخدم (§١-٢). الـ clipboard مش متقفل. |
| `Strict-Transport-Security` | **قرار المالك (§٤-١)** | |

- **مفيش `Content-Security-Policy` خالص في الـ PR ده** (ولا `frame-ancestors`)، عشان مانغطّيش على CSP بتاعة Next على `/_next/image`. منع التضمين بـ `X-Frame-Options` لوحده.
- **صفحة الإيصال في المتجر:** الـ rule بتاعتها بتفضل **بعد** الـ rule العامة، فـ `Referrer-Policy: no-referrer` بيكسب على `/order/:orderNumber` (في Next، لو rule-تين اتطابقوا على نفس المفتاح، الأخيرة بتكسب)، و`Cache-Control: private, no-store` زي ما هو.

### ٤-١ HSTS — قرار مطلوب من المالك
- HSTS بيقول للمتصفح «افتح الموقع ده بـ https بس» لمدة معيّنة. **المدة دي بتتخزّن في متصفح كل زائر، ومش بتختفي لو رجّعنا الكود** (الرجوع بيمنع الـ header الجديد بس؛ اللي اتخزّن بيفضل لحد ما مدته تخلص).
- الاختيارات:
  - **(أ) مقترح:** `max-age=15552000` (6 شهور)، من غير `includeSubDomains` ومن غير `preload`.
  - **(ب)** `max-age=63072000` (سنتين)، من غير `includeSubDomains` ومن غير `preload`.
  - **(ج)** من غير HSTS في الكود، لو قراية §٥ أثبتت إن Vercel بيبعته أصلًا.
- `includeSubDomains` و`preload` برّه النطاق في كل الاختيارات.

### ٤-٢ اختبارات الـ headers
- **قبل الدمج (CI):** سكربت بعد `next build` بيقرا `.next/routes-manifest.json` للتطبيقين ويحسب الـ headers النهائية لمسارات عيّنة (`/` · صفحة منتج · `/order/X` في المتجر · `/login` و`/orders` في اللوحة): القيم في الجدول موجودة، وعلى `/order/X` `Referrer-Policy` = `no-referrer` و`Cache-Control` = `private, no-store`، ومفيش أي rule بتحط `Content-Security-Policy`.
- **بعد النشر:** قراية headers الموقع الحقيقي (§٥-٢)، بموافقة لوحدها.

## ٥) قراية الـ headers من الموقع (Production) — كل واحدة بموافقة المالك لوحدها
- **٥-١ قبل الكود:** طلب `GET` عادي زي أي زائر لصفحة المتجر الرئيسية وصفحة دخول اللوحة، وتسجيل الـ headers اللي راجعة (من غير دخول، من غير داتابيز، من غير أي كتابة). الغرض: نعرف Vercel بيبعت إيه أصلًا (خصوصًا HSTS) قبل قرار §٤-١. رابط اللوحة مايتكتبش في الريبو.
- **٥-٢ بعد النشر:** نفس القراية، والمقارنة بالجدول.

## ٦) بعد الدمج
- الدمج بينشر التطبيقين. بعده:
  - المالك يجرّب: الدخول للوحة (أو التأكد إن الجلسة لسه شغالة)، فتح صفحة الطلبات وصفحة منتج من غير حفظ، والخروج والدخول تاني؛ وفي المتجر: الرئيسية وصفحة منتج والسلة لحد Checkout من غير تأكيد.
  - قراية §٥-٢ بموافقة لوحدها.
- **لو الدخول باظ:** الرجوع = revert للـ PR (كود بس، مفيش SQL). الكوكيز اللي اتكتبت HttpOnly بتتكتب من جديد بالخيارات القديمة مع أول تجديد. HSTS: زي §٤-١.

## ٧) برّه النطاق
- CSP كاملة: بند لوحده بعدين، يبدأ `Report-Only` (Next محتاج nonces للـ scripts وده تغيير كبير).
- `includeSubDomains` و`preload` في HSTS.
- Dependabot، وحدود عدد الطلبات، وباقي بنود المراجعة الأمنية.

## ٨) الملفات المتوقعة في PR الكود
- `apps/admin/lib/auth/cookieOptions.ts` (جديد) · `apps/admin/lib/auth/supabaseServer.ts` · `apps/admin/lib/auth/supabaseMiddleware.ts` · (لو لزم للاختبار) `apps/admin/middleware.ts` من غير تغيير سلوك.
- `apps/admin/lib/auth/cookies.cases.ts` (جديد) · `apps/admin/scripts/run-cases.mjs` (suite + ربط الحزم).
- `apps/storefront/next.config.mjs` · `apps/admin/next.config.mjs`.
- سكربت فحص الـ headers بعد البناء + خطوة في `.github/workflows/ci.yml`.
- **مفيش** تغيير في `package.json` ولا `pnpm-lock.yaml`.

## ٩) الترتيب
1. مراجعة العقد ده (PR وثائق بس) ← قرار المالك في §٤-١ ← دمج العقد بأمر المالك.
2. §٥-١ (قراية headers الموقع) بموافقة لوحدها — ممكن قبل قرار §٤-١ عشان يبني عليها.
3. PR الكود (§٨) بأمر المالك ← CI ← مراجعة ← دمج بأمر المالك.
4. §٦ (تجربة المالك + §٥-٢).
