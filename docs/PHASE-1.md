# المرحلة ١ — فصل المتجر عن الداشبورد (الهيكل فقط)

الفرع: `feat/storefront-admin-split`

## اللي اتعمل

| # | البند | الحالة |
| --- | --- | --- |
| 1 | تحويل الريبو إلى pnpm workspace | ✅ |
| 2 | `apps/storefront` — تطبيق Next.js 15 مستقل لـ Vercel | ✅ |
| 3 | `packages/core` — الأنواع والتسعير والتحقق المشترك | ✅ |
| 4 | إعادة كتابة صفحات المتجر mobile-first | ✅ |
| 5 | الداشبورد يفضل في Retool | ✅ (`backend/` و `frontend/` ما اتلمسوش) |

## اللي **ما** اتعملش (بقرار صريح)

- مفيش اتصال بقاعدة البيانات من `apps/storefront`.
- مفيش إنشاء طلب — زرار التأكيد معطّل ومكتوب جنبه السبب.
- مفيش SQL ولا migrations.
- مفيش أسرار ولا ملفات `.env` في الريبو.
- مفيش صور — الواجهة بتستخدم رسمة CSS احتياطية لحد ما Storage يتربط.

## الهيكل

```
zell-store/
├─ apps/storefront/        Next.js (App Router) → Vercel
│   ├─ app/                / · /product/[id] · /cart · /checkout
│   ├─ components/store/   مكوّنات المتجر
│   ├─ components/ui/      Button · Field
│   └─ lib/                cart (localStorage) · catalog (مؤقت) · cn
├─ packages/core/          منطق صافي مشترك: تسعير · أنواع · تحقق · رقم الطلب · روابط الصور
├─ backend/                تطبيق Retool — من غير أي تعديل
└─ frontend/               تطبيق Retool — من غير أي تعديل
```

## التشغيل محلياً

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build
```

> أول `pnpm install` هيولّد `pnpm-lock.yaml` — اعمله commit عشان البناء يبقى ثابت.

## إعداد Vercel

| الإعداد | القيمة |
| --- | --- |
| Framework Preset | Next.js |
| Root Directory | `apps/storefront` |
| Install / Build Command | الافتراضي |

Vercel بيكتشف الـ workspace من `pnpm-workspace.yaml` في الجذر تلقائياً.

## متغيّرات البيئة (مرحلة ٢ — مش دلوقتي)

الأسماء بس للتوثيق، من غير أي قيم، وتتحط في لوحة Vercel مباشرة:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server-only، للـ API route بس
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`

## مؤقت ولازم يتشال في المراحل الجاية

| الملف | السبب |
| --- | --- |
| `apps/storefront/lib/catalog.ts` | بيانات منسوخة من Production — تتبدل بقراءة server-side |
| `components/store/FilmArt.tsx` | رسمة احتياطية — تفضل fallback بعد ربط الصور |
| زرار «تأكيد الطلب» المعطّل | يتربط بـ `/api/orders` |
| رابط واتساب في الـ checkout | مخرج مؤقت لحد ما الطلب يشتغل |

## المرحلة الجاية

1. قراءة المنتجات والإعدادات من Supabase (server-side، `anon` + policies محدودة).
2. `/api/orders` على Vercel: validation + rate limiting + idempotency ← عملية ذرّية في الداتابيز.
3. ربط الصور من `product_images` و `site_images`.
4. صفحة نجاح `/order/[orderNumber]`.
