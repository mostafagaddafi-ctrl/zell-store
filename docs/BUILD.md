> # 🗄️ لقطة قديمة — الأرقام مش محدّثة
>
> أرقام الـ bundle اللي تحت من بناء **قديم** قبل ما `apps/admin`
> يتعمل. ماتعتمدش عليها كقياس حالي.
>
> وقت ما اتكتبت الوثيقة، اللوحة مكانتش موجودة؛ دلوقتي هي تطبيق
> منفصل بيتبني وبيتنشر لوحده.
>
> لأرقام محدّثة: شغّل `pnpm --filter @zell/storefront build`.

---

# نتيجة البناء — `feat/storefront-admin-split`

البناء اتنفّذ فعليًا على **GitHub Actions** (ubuntu-24.04)، مش محليًا.
سجل التشغيل الكامل متاح في تبويب Actions على الفرع.

## البيئة

| | |
| --- | --- |
| نظام التشغيل | Ubuntu 24.04.5 LTS |
| Node | 20 (من `actions/setup-node`) |
| pnpm | 9.15.4 (مقروء من حقل `packageManager`) |
| الأمر | `pnpm install --no-frozen-lockfile` ثم `pnpm build` |

## النتيجة: ✅ نجح

| الخطوة | النتيجة |
| --- | --- |
| Install | ✅ 139 حزمة — Done in 8s |
| Typecheck `@zell/core` | ✅ |
| Typecheck `@zell/storefront` | ✅ |
| Build storefront | ✅ Compiled successfully in 9.9s |
| Static generation | ✅ 9/9 صفحة |

## مخرجات Next.js

```
Route (app)                                 Size  First Load JS
┌ ○ /                                    2.27 kB         108 kB
├ ○ /_not-found                            123 B         103 kB
├ ○ /cart                                5.69 kB         119 kB
├ ○ /checkout                            2.23 kB         119 kB
└ ● /product/[productId]                 2.78 kB         120 kB
    ├ /product/1
    ├ /product/2
    └ /product/3
+ First Load JS shared by all             103 kB
  ├ chunks/12fcdf82   54.2 kB
  ├ chunks/212        46.4 kB
  └ other shared      1.92 kB

○  (Static)  prerendered as static content
●  (SSG)     prerendered as static HTML (uses generateStaticParams)
```

**كل الصفحات static أو SSG** — مفيش أي رندر على السيرفر وقت الطلب، لأن مفيش
مصدر بيانات لسه. ده هيتغيّر في المرحلة الجاية لما القراءة تيجي من Supabase.

### قراءة الأرقام

- **103 kB** JS مشترك لكل الصفحات — أساس React + Next، مقبول لمتجر.
- صفحة المنتج **120 kB** وهي أتقل صفحة، لأنها بتحمّل منطق المقاس والسلة.
- الرقم ده **من غير صور** ومن غير لوحة تحكم — الداشبورد مش في الـ bundle ده أصلاً،
  وده كان أحد أهداف الفصل.

## تحذيرات (غير حاجبة)

| التحذير | التقييم |
| --- | --- |
| `No build cache found` | طبيعي في أول تشغيل. يختفي مع تفعيل الكاش على Vercel. |
| `Node.js 20 is deprecated` على actions | بيخص وقت تشغيل الـ actions نفسها مش بناء المشروع. يتعالج بترقية الـ actions لاحقًا. |

## `pnpm-lock.yaml`

اتولّد من `pnpm install` **حقيقي** داخل CI واتعمل له commit تلقائي —
مكتبش الملف بالإيد لأن قفل اعتماديات ملفّق أسوأ من غياب القفل.

## CI

`.github/workflows/ci.yml` بيشتغل على:

- أي push على `feat/storefront-admin-split`
- أي pull request
- تشغيل يدوي (`workflow_dispatch`)

مفيش أي secret مستخدم، ومفيش أي وصول لقاعدة بيانات أو نشر.

## Vercel Preview

Preview محتاج ربط الريبو بمشروع Vercel، وده خارج صلاحياتي — مفيش مورد Vercel
في المساحة دي. بعد ربط المشروع:

| الإعداد | القيمة |
| --- | --- |
| Root Directory | `apps/storefront` |
| Framework Preset | Next.js |
| Install / Build Command | الافتراضي |

أول ما الريبو يترتبط، الـ PR المفتوح هيولّد Preview تلقائيًا.
