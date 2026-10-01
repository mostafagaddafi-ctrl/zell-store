# مصادقة لوحة التحكم — المرحلة ج

المصادقة بس. مفيش تعديلات، مفيش نشر، مفيش لمس للمتجر.
**ADMIN_MUTATIONS_ENABLED لسه false.**

---

## القرارات

| القرار | السبب |
| --- | --- |
| Supabase Auth ببريد وكلمة مرور | أبسط حاجة تكفي، ومفيش حاجة تتخزن عندنا |
| مفيش تسجيل حسابات | الحسابات بتتعمل يدوي في لوحة Supabase |
| مفيش magic-link ولا استرجاع كلمة مرور | برّه نطاق المرحلة دي |
| مفيش `/auth/callback` | كان هيبقى كود ميت مع password-only |
| **مفيش عميل Supabase في المتصفح** | من غيره مفيش أي داعي لـ `NEXT_PUBLIC_` |
| `getUser()` دايمًا | `getSession()` بيقرا الكوكي من غير تحقق — قابل للتزوير |
| الحارس في كل صفحة وكل Action | الـ layout مش حدود أمان في App Router |

---

## الأدوار

`owner` و `admin`. في المرحلة دي الاتنين ليهم نفس الوصول — الفرق
هيتفعّل لما التعديلات تتفتح.

الدور بيتقرا من `public.admin_users`. الجدول:

    user_id    uuid PK -> auth.users(id) on delete cascade
    role       text: owner | admin
    is_active  boolean
    created_at timestamptz
    updated_at timestamptz

RLS مفعّل، **صفر policies**، و `anon` و `authenticated` مالهمش أي
وصول. القراءة بتتم من السيرفر بصلاحية الخدمة بس.

**البريد مش مكرر في `admin_users` عن قصد.** مصدره الوحيد
`auth.users` عن طريق `getUser()` — التكرار كان هيسمح باختلاف بين
الاتنين، والاختلاف ده بيبقى مشكلة أمان مش مشكلة عرض.

---

## المسارات

| المسار | الطريقة | الحماية |
| --- | --- | --- |
| `/login` | GET + Server Action | عام |
| `/403` | GET | عام |
| `/auth/signout` | **POST بس** (GET -> 405) | عام |
| باقي المسارات | GET | `requireAdminPage()` |

مجموعات المسارات:

    app/
      layout.tsx            هيكل HTML وبس
      (auth)/               عام — مفيش قراءة ولا حارس
        login/
        403/
      (dashboard)/          محمي — حارس + شِل + قراءة
        page.tsx  orders/  products/  content/  identity/  settings/  shipping/
      auth/signout/         راوت POST

المجموعات مابتغيّرش أي URL. `/orders` فضل `/orders`.

---

## مسار الكوكيز

تسجيل الدخول Server Action، فالكوكيز بتتكتب على السيرفر:
HttpOnly و Secure و SameSite=Lax و Path=/. المتصفح مايشوفش التوكن
من JavaScript، ومايشوفش أي مفتاح.

    المتصفح --POST--> signInAction
                        createAuthClient(anon, cookies())
                        signInWithPassword()
                        setAll() -> كوكيز الجلسة

    كل request --> middleware.ts
                     getUser()  <- بيجدّد التوكن لو خلص
                     الكوكيز المجدّدة بتتنقل على الرد
                     (وكمان على أي redirect — لو اتنسيت التجديد بيضيع)

    Server Component / Action --> createAuthClient(anon, cookies())
                                    getUser()
                                    admin_users (service role)

مفتاحين، كل واحد له شغله:

| المفتاح | بيعمل إيه |
| --- | --- |
| `SUPABASE_ANON_KEY` | الهوية بس: دخول، تجديد، خروج |
| `SUPABASE_SERVICE_ROLE_KEY` | قراءة `admin_users` + قراءات المرحلة ب |

---

## الحراس

`requireAdminPage()` — بيرجّع الهوية أو بيعمل redirect:

| الحالة | النتيجة |
| --- | --- |
| مفيش جلسة | `/login?next=...` |
| جلسة بلا صف مفعّل | `/403` |
| الشبكة أو الإعدادات وقعت | `/login?error=unavailable` |

`requireAdminAction()` — مابيعملش redirect، بيرجّع فشل:

| الحالة | الكود |
| --- | --- |
| مفيش جلسة | `UNAUTHENTICATED` |
| جلسة بلا صف مفعّل | `FORBIDDEN` |

الترتيب جوه كل Action **مقصود**:

    requireAdminAction()  ->  UNAUTHENTICATED | FORBIDDEN
    guardMutations()      ->  DISABLED
    تحقق المدخلات          ->  VALIDATION
    الكتابة

العكس كان هيقول لمجهول "التعديلات موقوفة"، وده تسريب معلومة عن
حالة النظام لحد مش مفروض يعرف حاجة أصلًا.

**`resolveAdminIdentity` مش ملفوفة في `cache()` عن قصد.**

`cache()` بتعمل memoization على مستوى الـ render — ضمان أداء مش ضمان
أمان. نطاقها بيتحدد بسياق React مش بحدود الطلب، وأي تغيير في السياق ده
بيبقى تغيير صامت في نطاق قرار صلاحية.

يعني كل نداء للحارس بيعمل `getUser()` وقراءة دور جديدين — نداءين
زيادة على الصفحة المحمية (الـ layout والصفحة)، والتكلفة دي مقبولة مقابل إن
كل Server Action تتحقق بنفسها للنداء بتاعها هي.

---

## الـ middleware

بيعمل حاجتين: يجدّد الجلسة، ويوجّه توجيه مبدئي.
**وبس.** مش حدود أمان، ومكتوب كده في الملف نفسه.

سبب إنه مش حدود أمان: الـ matcher ممكن يفوّت مسار، والـ Server
Actions ممكن تتنادى من غير ما تعدّي عليه بالشكل المتوقع. الاعتماد
عليه وحده كان بيخلي أي ثغرة في الـ matcher ثغرة في النظام كله.

بيحط هيدر `x-admin-path` عشان `requireAdminPage` يعرف يبني `next`
صح.

---

## تنظيف next

`sanitizeNext` بترفض وترجّع `/` من غير أي محاولة إصلاح:

| المدخل | ليه مرفوض |
| --- | --- |
| `//evil.com` | protocol-relative — بيطلع برّه |
| `https://evil.com` | أصل خارجي |
| `/\evil.com` | بعض المتصفحات بتقراه زي `//` |
| أي حرف تحكم أو مسافة | تهريب هيدرات |
| `/login` · `/403` · `/auth/*` | حلقة توجيه |

---

## حالات الفشل

| الحالة | السلوك |
| --- | --- |
| بريد أو كلمة مرور غلط | رسالة واحدة موحّدة — مفيش تعداد حسابات |
| دخول ناجح بلا صف في `admin_users` | `signOut()` فورًا + رسالة واضحة |
| `is_active=false` وسط الجلسة | `/403` في أول request جاي |
| `getUser()` وقع | **فشل مقفول** -> `/login?error=unavailable` |
| `SUPABASE_ANON_KEY` ناقص | استثناء باسم المتغير — **من غير قيمته أبدًا** |
| refresh token خلص | الكوكيز بتتمسح -> `/login` |
| `GET /auth/signout` | 405 من غير أي تغيير حالة |
| Action من غير جلسة | `UNAUTHENTICATED` |
| Action بجلسة بلا صلاحية | `FORBIDDEN` |
| Action مصرّح له | `DISABLED` — العلم لسه false |

---

## متغيرات البيئة

| المتغير | سري؟ | الحالة |
| --- | --- | --- |
| `SUPABASE_URL` | لا | موجود |
| `SUPABASE_ANON_KEY` | لا، بس مايتعرضش | **جديد** |
| `SUPABASE_SERVICE_ROLE_KEY` | 🔒 نعم | موجود — لسه مؤقت |
| `ADMIN_MUTATIONS_ENABLED` | لا | **false** |

مفيش أي `NEXT_PUBLIC_`. مفيش أي تعديل على `vercel.json` —
اللوحة **ما بتتنشرش**.

---

## ملاحظة للنشر (مرحلة جاية)

الـ middleware بيشتغل على Edge runtime، و Next بيثبّت قيم
`process.env` وقت البناء للـ Edge. يعني لو اللوحة اتبنت من غير
`SUPABASE_ANON_KEY` موجود، الـ middleware هيلاقيها فاضية وقت
التشغيل.

ده **مش** ثغرة أمان: الحراس على السيرفر بيقروا المتغيرات وقت
التشغيل عادي، والـ middleware أصلًا مش حدود أمان. بس اللي هيحصل
إن تجديد الجلسة هيقف وكل طلب هيروح `/login`.

لما نوصل للنشر: المتغيرات لازم تكون موجودة **وقت البناء** كمان،
مش وقت التشغيل بس.

الـ CI الحالي بيبني من غير أي مفاتيح وده مقصود — كل الصفحات
`force-dynamic` فمفيش أي قراءة وقت البناء.

---

## اللي لسه ناقص بعد المرحلة دي

| | |
| --- | --- |
| استرجاع كلمة المرور | مرحلة جاية |
| MFA | مرحلة جاية |
| سجل دخول / تدقيق | مفيش |
| فصل صلاحيات `owner` عن `admin` | مع فتح التعديلات |
| تبديل service-role بدور قراءة محدود | قبل النشر |
| نشر اللوحة | مؤجل بقرار |
