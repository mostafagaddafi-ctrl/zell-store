# عقد 0021-P — الكود (اللوحة)

| | |
| --- | --- |
| الحالة | **مسودة للمراجعة.** ممنوع أي كود قبل اعتمادها |
| الأساس | `docs/contracts/0021-P.md` (الداتابيز متطبّقة على Production من 2026-10-07) |
| قرار التقسيم | المراجع (ج-3): **(أ)** نقل دوال القراءة ← **(ب1)** الأساس + فاحص بيبلّغ ← **(ب2)** التغليف + فاحص بيمنع |
| المستوى | الـ PRs التلاتة **كاملين** (بيلمسوا `lib/mutations` و`lib/data` وauth وCI) |
| النشر | دمج أي PR من التلاتة بيبني اللوحة على Production لوحده = **موافقة نشر منفصلة** من المالك لكل واحد |
| الـ Spike المرجعي | `8260b53` (الفرع اتمسح، والـ commit لسه بيتقري بالـ SHA الكامل): `lib/spike/access/wrappers.ts` و`scripts/check-access.mjs` (+ selftest) |

---

## ١) الهدف

- كل **page** و**layout** و**route method** و**Server Action** في اللوحة يتصدّر **من خلال غلاف واحد** بصلاحية مكتوبة نصًا من الـ ٢٩ صلاحية.
- **مفيش أي تغيير في السلوك** طول ما `ADMIN_ACCESS_MODE=legacy` (الافتراضي). التحويل لـ `shadow` ثم `enforce` **مش** في الـ PRs دي (§٧).
- الفاحص في CI بيضمن إن مفيش حاجة جديدة تتضاف من غير غلاف (`findings = 0` على اللوحة كلها بعد ب2).

**الأرقام اللي العقد ماشي عليها (main `f7c0589`):**
- ٥١ Server Action: ٣٣ في `lib/actions.ts` · ٤ في `lib/couponActions.ts` · ١٤ في `lib/inventoryActions.ts`. (`signInAction` عامة ومش متغلّفة.)
- ٢٤ صفحة تحت `app/(dashboard)`، و`app/(dashboard)/layout.tsx`.
- ٣ راوتات: `api/admin/products/[productId]/images` · `api/admin/site-images` · `api/admin/collections/[id]/cover` (POST).
- عامّين ومش متغلّفين: `app/layout.tsx` · `app/(auth)/layout.tsx` · `app/(auth)/login/*` · `app/(auth)/403/page.tsx` · `app/auth/signout/route.ts`.

لو أي رقم اختلف وقت التنفيذ، الـ PR بيكتب الرقم الجديد وسببه.

---

## ٢) نموذج النداء: جلسة المستخدم، مش service_role

- **`zell_erp_*` بتتنادى بس بعميل جلسة المستخدم:** `createAuthClient()` (`lib/auth/supabaseServer.ts`: `@supabase/ssr` بالـ **anon key** + كوكيز الجلسة). PostgREST بياخد الـ JWT من الكوكي، ويشغّل الدالة بدور `authenticated`، والـ `sub` هو الممثل.
- **ممنوع** نداء أي `zell_erp_*` أو `erp_*` بـ `SUPABASE_SERVICE_ROLE_KEY` (`lib/data/client.ts`). ومنح `service_role` عليهم صفر أصلًا، فالنداء ده هيرجع 42501.
- **ممنوع** أي `p_actor` أو `user_id` جاي من المتصفح أو من الـ props. الهوية من الكوكي في كل request.
- **الترتيب جوه الغلاف ثابت:** الهوية ← الصلاحية ← علم التعديلات (لو `mutates`) ← الدالة.
- **كاش:** الهوية والصلاحيات بتتحسب **مرة لكل request** بالكتير (`React.cache` مسموح جوه الـ request الواحد). ممنوع أي كاش بين requests أو مستخدمين.
- **فشل القراءة = مقفول:** أي error أو timeout (٣ ثواني) في `getUser()` أو `zell_erp_my_access()` = `unavailable`.
- **`admin_users`:** قراءة الدور في `readAdminRole` (بـ service_role) بتفضل زي ما هي. هي مصدر وضع `legacy`، ومصدر تجاوز المالك في الكود.

---

## ٣) الأوضاع (`ADMIN_ACCESS_MODE`)

| الوضع | القرار من | بينادي `zell_erp_*`؟ | ملاحظات |
| --- | --- | --- | --- |
| `legacy` (الافتراضي) | `admin_users` زي النهارده | **لا، خالص** | أي نداء `zell_erp_record_shadow_event` بيكتب سطر = «استخدام حقيقي» وبيقفل rollback 0021-P. عشان كده legacy مابيناديش ولا دالة |
| `shadow` | `admin_users` زي النهارده | أيوه: `zell_erp_my_access()`، و`zell_erp_record_shadow_event()` لو فيه اختلاف | الاختلاف بيتسجّل (`legacy_allow_new_deny` · `legacy_deny_new_allow` · `new_unavailable`)، والقرار مابيتغيّرش. التسجيل best-effort بحد ١٫٥ ثانية، وفشله مابيوقفش الطلب |
| `enforce` | `zell_erp_my_access()` | أيوه | تجاوز المالك من الداتابيز. فشل القراءة = `UNAVAILABLE` |

- **قراية المتغير:** غايب = `legacy`. أي قيمة غير الـ ٣ بالظبط = `legacy`، و«حالة النظام» بتعرضها غلط بالأحمر.
- **قرار `legacy` لكل صلاحية:** المالك الشغال = مسموح. الأدمن الشغال = مسموح لو فئة الصلاحية `operational` أو `sales`، وممنوع لو `owner`. ده بالظبط سلوك النهارده: `ownerGate` موجود على الكوبونات والمخزون بس، وهما صلاحيات فئة `owner`.

---

## ٤) PR (أ): نقل دوال القراءة من `lib/mutations` لـ `lib/data` (refactor بس)

**ليه:** الفاحص بيمنع استيراد `lib/mutations/**` من برّه طبقة الكتابة. والصفحات بتستورد منها دوال قراءة دلوقتي، فلازم القراءة تبقى في `lib/data` الأول، من غير ما تتخلط مع أي تغيير سلوك.

**الدوال الـ ٢٦** (الاسم مايتغيّرش، والملف الجديد `apps/admin/lib/data/<نفس اسم الملف>.ts`):

| من `lib/mutations/` | الدوال |
| --- | --- |
| `addonsTitle.ts` | `readAddonsTitle` |
| `collections.ts` | `collectionProductCounts` · `readAdminCollection` |
| `coupons.ts` | `listCoupons` · `readCouponsSwitch` · `countLiveCoupons` |
| `homeProducts.ts` | `readHomeProducts` |
| `installation.ts` | `readShippingAreaGroups` · `readInstallationRecord` · `readInstallation` |
| `installationToolsPage.ts` | `readInstallationToolsPage` · `readToolsSummary` |
| `inventory.ts` | `listSuppliers` |
| `inventoryOpenings.ts` | `listOpenings` · `getOpening` · `listLots` |
| `inventoryPurchases.ts` | `listPurchases` · `getPurchase` · `loadSupplierOptions` · `loadLocationOptions` |
| `productAddons.ts` | `readAddonOptions` · `readProductAddons` |
| `productWidths.ts` | `readProductWidths` |
| `shippingAreas.ts` | `readShippingAreas` |
| `shippingOrder.ts` | `readShippingOrder` |
| `socialLinks.ts` | `readSocialLinks` |

**المسموح بس:**
1. نقل الـ declaration بالحرف (من `export` لحد القوس الأخير).
2. سطور `import` / `export`.
3. helper خاص بيستخدمه القراءة والكتابة مع بعض: يا يفضل مكانه ويتضاف له `export` بس، يا يتنقل بالحرف. وفي الحالتين بيدخل جدول البصمات.

**ممنوع:**
- أي تغيير جوه جسم أي دالة، ولو مسافة.
- إعادة تسمية.
- re-export من `lib/mutations` (الفاحص هيرفضه بعدين).
- نقل أي دالة كتابة.
- أي ملف برّه `apps/admin/lib/` و`apps/admin/app/` و`apps/admin/components/` و`docs/maps/code-map.md`.

**الملفات المتوقعة:**
- ~١٤ ملف جديد في `lib/data/`.
- الـ ١٤ ملف بتوع `lib/mutations/` (حذف الدوال المنقولة + imports).
- كل ملف بيستورد واحدة من الـ ٢٦ (تغيير المسار بس). الـ PR بيكتب القايمة.
- `docs/maps/code-map.md` (وصف `lib/data`).

**معيار القبول:**
- **جدول بصمات في وصف الـ PR:** لكل دالة وhelper اتنقل: الاسم · الملف قبل/بعد · `sha256` للنص بالحرف على main وعلى الـ head. لازم يبقوا متطابقين ٢٦/٢٦ (+ الـ helpers).
  - **طريقة الحساب:** النص من أول `export` (أو `function` للـ helper) لحد القوس اللي بيقفل الجسم، من غير أي تطبيع. والمراجع بيعيد الحساب بنفس الطريقة من الـ blobs.
- **الـ diff:** مفيش سطر متغيّر غير الـ declarations المنقولة وسطور import/export. والسطور المضافة ≈ السطور المحذوفة.
- **CI:** typecheck + build ناجحين، و`ZELL_ADMIN_CASES_RESULT pass=503 fail=0` (أو العدد الحالي وقت التنفيذ، بصفر فشل).
- **بعد النشر:** المالك يفتح ٥ صفحات (المنتج · الأقسام · الكوبونات · مستند شراء · الشحن)، وكلهم يشتغلوا زي الأول.

**الرجوع:** revert للـ PR (مفيش داتابيز).

---

## ٥) PR (ب1): الأساس + الفاحص بيبلّغ

**مفيش أي صفحة أو action بتتغلّف هنا.** السلوك مايتغيّرش، غير سطرين جداد في «حالة النظام».

**الملفات المتوقعة:**

| الملف | فيه إيه |
| --- | --- |
| `apps/admin/lib/access/capabilities.ts` | الـ ٢٩ صلاحية وفئة كل واحدة (نفس قايمة الداتابيز بالحرف) + `isCapability` |
| `apps/admin/lib/access/wrappers.ts` | `createAccessWrappers(deps)`: `pageWithAccess` · `layoutWithSession` · `routeWithAccess` · `actionWithAccess` · `formActionWithAccess`. منطق صافي من غير I/O (نفس شكل الـ Spike) |
| `apps/admin/lib/access/resolve.ts` | قراية `ADMIN_ACCESS_MODE` + resolver لكل وضع (§٣). legacy = `resolveAdminIdentity()` + قرار الفئة. shadow/enforce = `createAuthClient().rpc('zell_erp_my_access')` بفحص شكل الرد |
| `apps/admin/lib/access/instance.ts` | `import 'server-only'` + الأغلفة الحقيقية (redirect للصفحات زي `requireAdminPage` بالظبط، ونتيجة فشل زي `requireAdminAction` بالظبط) |
| `apps/admin/lib/access/*.cases.ts` | حالات: كل وضع × (anonymous · forbidden · unavailable · owner · admin) × (فئة owner / غير owner) × (mutates مع العلم true/false) · الترتيب · فشل الـ RPC = unavailable · شكل رد غلط = unavailable · قيمة وضع غلط = legacy |
| `apps/admin/scripts/check-access.mjs` (+ `check-access.selftest.mjs`) | الفاحص من الـ Spike (AST بـ TypeScript الموجود، من غير dependency جديدة)، بالقواعد في §٦ |
| `.github/workflows/ci.yml` | خطوة: selftest الفاحص + الفاحص بوضع `report` بيطبع `ZELL_ACCESS_FINDINGS=<n>` ومابيفشلش + فحص إن قايمة `capabilities.ts` = قايمة الـ SQL (المحرك + المحوّل) |
| `apps/admin/lib/systemHealth.ts` (+ عرضه) | `ADMIN_ACCESS_MODE` الحالي، و`disable_signup` من `GET /auth/v1/settings` (بالـ anon key). Sign ups مفتوحة = أحمر |
| `apps/admin/.env.example` | `ADMIN_ACCESS_MODE=legacy` (اسم بس) |
| `docs/maps/code-map.md` · هذا العقد | `lib/access` والفاحص |

**معيار القبول:**
- قايمة الصلاحيات في TS = قايمة الداتابيز (٢٩، بالفئات)، ومتفحوصة في CI من ملفات الـ SQL نفسها.
- selftest الفاحص ناجح، و`ZELL_ACCESS_FINDINGS` مطبوع (المتوقع ≈ ٧٩: ٥١ action + ٢٤ صفحة + layout + ٣ راوتات، بالإضافة لاستيرادات `lib/mutations` وأي حارس مباشر).
- حالات `lib/access` ناجحة، و`ZELL_ADMIN_CASES_RESULT … fail=0`.
- مفيش ملف تحت `app/` اتغيّر غير عرض «حالة النظام».
- مفيش أي نداء `zell_erp_*` ممكن يحصل في `legacy` (حالة بتثبت إن resolver الـ legacy مابيلمسش `createAuthClient().rpc`).

**الرجوع:** revert (مفيش داتابيز، والوضع `legacy`).

---

## ٦) قواعد الفاحص (`check-access.mjs`)

نفس أكواد الـ Spike، والمسارات بتاعة `lib/access` بدل `lib/spike/access`:

| الكود | المعنى |
| --- | --- |
| `PAGE_NOT_WRAPPED` · `LAYOUT_NOT_WRAPPED` · `ROUTE_NOT_WRAPPED` · `ACTION_NOT_WRAPPED` | التصدير مش نتيجة نداء غلاف |
| `PAGE_EXTRA_EXPORT` · `LAYOUT_EXTRA_EXPORT` · `ROUTE_EXTRA_EXPORT` | تصدير غير المسموح (config زي `dynamic` مسموح) |
| `WRAPPER_NOT_FROM_ACCESS_MODULE` | الغلاف مش متستورد من `lib/access/instance` |
| `CAPABILITY_NOT_LITERAL` · `UNKNOWN_CAPABILITY` | الصلاحية مش نص ثابت، أو مش من الـ ٢٩ |
| `INLINE_USE_SERVER` | `'use server'` جوه دالة |
| `ACTION_REEXPORT` | re-export لـ action |
| `RAW_GUARD_IMPORT` | `requireAdminPage` / `requireAdminAction` / `resolveAdminIdentity` / `readAdminRole` برّه `lib/auth` و`lib/access` |
| `MUTATION_IMPORT_OUTSIDE` | استيراد `lib/mutations/**` أو `lib/inventory/rpc` من برّه `lib/mutations` و`lib/inventory` و`lib/data` و`lib/*Actions.ts` |

- **الملفات العامة** (§١) في قايمة صريحة جوه الفاحص، وأي إضافة ليها = مراجعة كاملة.
- الوضعين: `--mode report` (بيطبع ومابيفشلش) في ب1، و`--mode enforce` (أي finding = فشل) من ب2.

---

## ٧) PR (ب2): التغليف + الفاحص بيمنع

**الملفات المتوقعة:**
- الـ ٤ ملفات actions.
- الـ ٢٤ صفحة + `(dashboard)/layout.tsx`.
- الـ ٣ راوتات.
- `ci.yml` (الفاحص `enforce`).
- `lib/access/manifest.cases.ts` (أو اسم شبهه).
- `docs/maps/code-map.md` وهذا العقد.

**جدول الربط (manifest):** لكل واحد من الـ ٧٩: الرمز · الصلاحية · `mutates` · الحارس النهارده (أدمن / مالك بس / عام) · فحص العلم النهارده (أيوه / لا). بيتكتب في وصف الـ PR، ومعاه حالة في CI بتقرا الجدول. القواعد:

| النوع | الصلاحية |
| --- | --- |
| صفحة | `zell.<المنطقة>.view` (الرئيسية: `zell.dashboard.view`) |
| action بيكتب | `zell.<المنطقة>.edit`، أو الأدق: `zell.products.images_edit` · `zell.orders.status_edit` · `zell.orders.note_edit` · `zell.telegram.test` · `zell.storefront.revalidate` |
| الكوبونات | `zell.coupons.view` / `zell.coupons.edit` (owner) |
| المخزون (0020) | `zell.inventory0020.view` / `zell.inventory0020.edit` (owner) |
| actions لسه مش متعملة (placeholder) | `zell.unimplemented` (owner) |
| `(dashboard)/layout.tsx` | `layoutWithSession` (من غير صلاحية) |

**معيار القبول:**
- `ZELL_ACCESS_FINDINGS=0` بوضع `enforce` على اللوحة كلها، والـ CI بيفشل لو أي finding.
- **تكافؤ legacy:** حالة لكل رمز في الجدول بتثبت إن نتيجة legacy لـ (anonymous · forbidden · unavailable · owner · admin) = نتيجة النهارده (نفس الكود، ونفس الرسالة، ونفس الـ redirect).
- **الاختلافات المعروفة** لازم تتكتب في الوصف، ويوافق عليها المراجع صراحة. مفيش غيرها:
  1. **علم التعديلات:** `couponActions` و`inventoryActions` النهارده مابيفحصوش `ADMIN_MUTATIONS_ENABLED` (حسب بحث الكود، ويتأكد في الجدول). بعد `mutates: true`، لو العلم `false` هيرجعوا `DISABLED`. العلم `true` على Production، فمفيش فرق ظاهر دلوقتي، والاتجاه أأمن.
  2. **`zell.unimplemented`:** لو action متعلّمة كده بترجع النهارده «مش متعمل» للأدمن، هترجع `FORBIDDEN` بعد التغليف. لو ده موجود، يتعرض على المالك قبل الدمج.
- **مفيش نداء مباشر** لـ `requireAdminPage` / `requireAdminAction` برّه `lib/auth` و`lib/access`.
- `ZELL_ADMIN_CASES_RESULT … fail=0`، وtypecheck + build.
- **بعد النشر (legacy):** المالك يجرّب بحسابه: ٥ صفحات + حفظ واحد. وبحساب الأدمن التجريبي: صفحة عادية تفتح، والكوبونات والمخزون `/403` زي النهارده.

**الرجوع:** revert. الوضع `legacy`، فمفيش أي سطر اتكتب في جداول 0021-P، والـ rollback بتاع الداتابيز لسه متاح.

---

## ٨) بعد ب2 (مش في الـ PRs دي، وكل خطوة قرار منفصل)

1. **`shadow`:** تغيير متغير البيئة على Vercel = قرار المالك. ⚠ **أول حدث shadow بيقفل rollback 0021-P** (المتاح بعده freeze أو forward-fix). بعد فترة: `zell_erp_access_shadow_report` و`zell_erp_access_parity` لازم يبقوا نضاف.
2. **`enforce`:** قرار منفصل بعد ما الـ shadow يبقى نضيف.
3. **صفحة إدارة الصلاحيات** (منح · سحب · قوالب · إيقاف · السجل): عقد لوحده.
4. **0020 (`zell_inv_*`) بهوية الجلسة:** عقد لوحده بعد الـ PRs دي وقبل الإطلاق (قرار المراجع). لحد ساعتها، حماية 0020 من السيرفر بس.

---

## ٩) ممنوع في الـ PRs التلاتة

- أي تعديل SQL أو تشغيل على Production (الداتابيز متطبّقة، ومش محتاجة حاجة).
- تغيير `ADMIN_ACCESS_MODE` على Vercel.
- نداء `zell_erp_*` بـ service_role، أو تمرير هوية من المتصفح.
- إضافة dependency (الفاحص بيستخدم TypeScript الموجود).
- خلط (أ) بأي تغيير سلوك، أو خلط ب1 بتغليف.
