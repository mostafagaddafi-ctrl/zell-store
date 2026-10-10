# عقد تنضيف التجارب قبل الإطلاق (CLEAN-prelaunch)

> ⚠ **مسودة للمراجعة — ممنوع التنفيذ.** مفيش SQL ولا أي تشغيل على Production (حتى القراية) قبل اعتماد العقد، وكل خطوة على Production بأمر صريح منفصل من المالك.

| | |
| --- | --- |
| الحالة | مسودة للمراجعة، على main `9527e47` (بعد #122) |
| الأساس | أفكار وصف #111 (المقفول من غير دمج، والفرع `docs/prelaunch-cleanup-contract` مصدر) · `10-DECISIONS.md` («المتجر لسه ما اتطلقش: كل الطلبات تجارب») · قرارات المراجع 2026-10-10 (التنضيف قبل P1 · تبسيط العقد: كل الطلبات بتتمسح) |
| الترتيب | **قبل تطبيق 0021-A P1**، وبعده P1 ← P2 ← … ← A3 (منع DELETE على `orders` و`order_items`) |
| المستوى | كامل (مسح بيانات على Production) |

## ١) القواعد الحاكمة
1. **مرة واحدة قبل الإطلاق.** مش زرار ولا دالة دايمة ولا migration: سكربتات تشغيل تحت `backend/db/ops/`.
2. **كل الطلبات تجارب، وكلها بتتمسح.** مفيش طلب بيفضل.
3. **مفيش أي مسار بيمسح طلب عليه أوامر فلوس.** التنفيذ قبل P1 بس: الـ preflight بيرفض لو `order_payments` أو `zell_payment_commands` موجودين (`ZELL_CLEAN_P1_APPLIED`). وبعد P1 الـ FK restrict بيمنعه أصلًا.
4. **مفيش أي تعديل** على أي جدول برّه النطاق، ومفيش إيقاف لأي trigger.
5. **كل السكربتات بـ `set local timezone = 'UTC'`** علشان البصمات تبقى deterministic.

## ٢) النطاق
| | |
| --- | --- |
| **بيتمسح** | كل `orders` و`order_items` و`order_events` الموجودين وقت التنفيذ (بشرط إنهم نفس اللي المالك وافق عليه — §٤) |
| **بيفضل (ببصمة قبل/بعد — §٥)** | كل الجداول التانية: المنتجات والعروض والإضافات والأقسام · `settings` · الصور · الكوبونات · `admin_users` وجداول 0021-P · بوابة الطلبات وسجلها وفترات التسليم · المخزون (0020) كله |
| **برّه النطاق** | **المخزون التجريبي هيفضل ومش جزء من التنضيف ده** (عقد صغير لوحده بعد تنضيف الطلبات وقبل أي مخزون حقيقي — `docs/plans/ERP-PLAN.md`) · Storage · العدّادات والـ sequences (مابترجعش لـ 1) · رسايل تيليجرام اللي اتبعتت |

**أثر جانبي معروف:** استخدام الكوبون بيتحسب من الطلبات، فمسح الطلبات بيحرّر استخدام الكوبونات (وقفل الكود والنوع ممكن يتفك). والإيصال لأي طلب قديم بيرجّع «مش موجود».

## ٣) الـ FKs على `orders` (بالحرف — الـ preflight بيوقف عند أي اختلاف)
الشكل المتوقع من الملفات: `order_items` من `schema.sql` (FK من غير اسم صريح، فالاسم الافتراضي `order_items_order_id_fkey`) و`order_events` من A1.

| الاسم | الجدول ← الأب | العمود ← العمود | ON DELETE | ON UPDATE | deferrable | validated |
| --- | --- | --- | --- | --- | --- | --- |
| `order_events_order_fkey` | `public.order_events` ← `public.orders` | `order_id` ← `id` | **CASCADE** (`c`) — لازم | NO ACTION (`a`) | لأ | أيوه |
| `order_items_order_id_fkey` | `public.order_items` ← `public.orders` | `order_id` ← `id` | CASCADE (`c`) | NO ACTION (`a`) | لأ | أيوه |

- **الاستعلام** (نفسه في الحصر والـ dry-run والتنفيذ والفحص):

```sql
select c.conname || '|' || cn.nspname || '.' || cl.relname || '|'
       || (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality as k(attnum, ord)
             join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) || '|'
       || (select string_agg(a.attname, ',' order by k.ord) from unnest(c.confkey) with ordinality as k(attnum, ord)
             join pg_catalog.pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) || '|'
       || c.confdeltype || '|' || c.confupdtype || '|' || c.condeferrable::text || '|' || c.convalidated::text as fk
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class cl on cl.oid = c.conrelid
  join pg_catalog.pg_namespace cn on cn.oid = cl.relnamespace
 where c.contype = 'f' and c.confrelid = 'public.orders'::regclass
 order by c.conname;
```

- **المتوقع بالحرف (صفين بس):**
  `order_events_order_fkey|public.order_events|order_id|id|c|a|false|true`
  `order_items_order_id_fkey|public.order_items|order_id|id|c|a|false|true`
- **أي اختلاف** (اسم · جدول · عمود · ON DELETE · ON UPDATE · deferrable · validated) **أو أي FK جديد على `orders`** (زي جداول P1) = الـ preflight بيرفض (`ZELL_CLEAN_FK_SHAPE`) ونرجع للعقد.
- **الحصر بيطلّع نفس الاستعلام من Production.** لو `order_items` على Production مختلف عن `schema.sql` (اسم أو شكل)، نقف ونعدّل الجدول ده في العقد بمراجعة، قبل أي خطوة تانية.
- **شكل الحذف:** `delete from public.order_items` صريح الأول (علشان العدد يتعدّ ويتقارن)، وبعدين `delete from public.orders`، والأحداث بالـ cascade بس (`zell_order_trg_events_immutable` بيسمح بالـ DELETE بس لما الطلب نفسه يكون اتمسح). مفيش `delete` مباشر على `order_events` ولا `truncate`.

## ٤) موافقة المالك على اللي هيتمسح
- **الحصر (قراية بس)** بيطلّع: عدد `orders` · عدد كل حالة · أرقام الطلبات كلها مرتبة (من غير أي بيانات زباين) · عدد `order_items` · عدد `order_events` · الكوبونات المستخدمة · استعلام الـ FKs (§٣) · وجود جداول P1 · `idle_tx`.
- **المالك بيوافق على الأرقام دي بالظبط.** الموافقة اسمها `owner-approval-YYYY-MM-DD-prelaunch-clean`، والقيم المعتمدة بتتبعت في نص التشغيل بـ `set local` بعد `begin` (برّه الجسم): `zell.clean_orders` (أرقام الطلبات مرتبة بفاصلة) · `zell.clean_statuses` (زي `cancelled=1,delivered=1,new=3`) · `zell.clean_counts` (orders|items|events).
- **الـ preflight بيرفض لو أي حاجة اتغيّرت عن آخر موافقة** (طلب جديد · طلب اتمسح · حالة اتغيّرت · عدد سطور أو أحداث مختلف): `ZELL_CLEAN_APPROVAL_STALE`. وقتها حصر جديد وموافقة جديدة.

## ٥) بصمة الجداول برّه النطاق (قبل/بعد — أي اختلاف = rollback)
- **الجداول:** كل جدول عادي في `public` ماعدا `orders` و`order_items` و`order_events`، ومعاهم `auth.users` (العدد + الـ ids بس) و`storage.objects` (العدد + `bucket_id`/`name` بس).
- **البصمة لكل جدول:** العدد + md5 لصفوفه كاملة (`to_jsonb(t)::text`) مرتبة بالنص نفسه — من غير ما نحتاج نعرف المفتاح. والقايمة نفسها (أسماء الجداول) جزء من البصمة.
- **في التنفيذ:** البصمة بتتحسب في الـ preflight وتتحفظ (`set_config(…, true)`)، وبتتحسب تاني بعد المسح جوه نفس المعاملة. أي اختلاف = exception قبل الـ commit (`ZELL_CLEAN_OUTSIDE_CHANGED`)، يعني المعاملة كلها بترجع.
- الاستعلام بيتكتب بالحرف في PR التنفيذ، ونفسه في الـ dry-run والتنفيذ والفحص.

## ٦) الخطوات (كل خطوة على Production بأمر منفصل من المالك)
1. **الحصر** (§٤).
2. **موافقة المالك** على الأرقام بالظبط (§٤).
3. **backup كامل** جديد عند المالك.
4. **dry-run ثم التنفيذ ورا بعض في وقت هادي:**
   - **dry-run:** نفس جسم التنفيذ بالحرف بين `begin` و`rollback` (CI بيثبت md5 الجسم)، والنتيجة صفوف في SELECT واحد: هيتمسح كام من كل جدول · بصمات برّه النطاق · شكل الـ FKs.
   - **التنفيذ — معاملة واحدة:**
     - **preflight بيرفض لو:** P1 متطبّق · شكل الـ FKs مختلف أو فيه FK جديد (§٣) · أي حاجة اتغيّرت عن آخر موافقة (§٤) · `idle_tx` ≠ 0.
     - **الجسم:** §٣ «شكل الحذف».
     - **postflight بيرفض الـ commit لو:** `orders` ≠ 0 أو `order_items` ≠ 0 أو `order_events` ≠ 0 · أي بصمة برّه النطاق اتغيّرت (§٥) · أي حماية مش شغالة (§٧).
5. **الفحص بعد (verify، قراية بس)** — §٧.
6. بعدها خطة P1 ثم P2 في `08-HANDOFF-NOW.md` زي ما هي، وبعدين A3.

## ٧) الفحص بعد
- `orders` = 0 · `order_items` = 0 · `order_events` = 0.
- **بصمات برّه النطاق** (§٥) = الـ dry-run بالحرف.
- **الحمايات شغالة:** شكل الـ FKs (§٣) زي ما هو · triggers `orders_cancelled_final` · `orders_status_guard` · `orders_created_event` · `order_events_immutable` · `order_events_no_truncate` · triggers المخزون، كلها enabled · بصمة `zell_create_order` = `c131cb51cd86830e9445b139296b0281` · البوابة زي ما هي · RLS والصلاحيات زي ما هي · verify A1 وD و0021-P = PASS.
- **استعلام الأثر قبل/بعد** (نصّه بالحرف في وصف PR التنفيذ): الفرق في الطلبات والسطور والأحداث بس، و`idle_tx` = 0.

## ٨) الرجوع
- **الرجوع = استرجاع الـ backup الكامل** (الخطوة ٣). ده مقبول قبل الإطلاق لأن مفيش بيانات حقيقية.
- **الرجوع بالـ backup الكامل بيضيّع أي حاجة حصلت بعد المسح (طلبات جديدة · تعديلات إعدادات). فالرجوع لازم يحصل قبل أي طلب حقيقي، والمالك قابل ده.**

## ٩) تجربة الـ backup على مشروع مجاني (شروط المراجع)
لو الـ backup اتجرّب على مشروع Supabase مجاني (قبل التنضيف أو في أي وقت)، الشروط دي إلزامية:
- المشروع **ملك المالك بس**.
- **مفيش مفاتيح Production** (ولا مفاتيح المشروع المجاني) في الشات أو الريبو.
- المشروع **يتمسح بعد التجربة**.
- أي **resource مؤقت في Retool** للمشروع ده **يتشال** بعد التجربة.

## ١٠) التنفيذ (PR الجاي — مش في الـ PR ده)
- `backend/db/ops/clean_prelaunch_count.sql` (الحصر) · `clean_prelaunch.sql` (التنفيذ، والـ dry-run بنفس الجسم) · `clean_prelaunch_verify.sql`.
- **CI على Postgres 17 مؤقت** (قاعدة المالك: الحالات الكبيرة هنا، وProduction smoke بس): رفض بعد P1 · رفض FK بشكل مختلف (كل خانة) أو FK جديد · رفض لو العدد أو الأرقام أو الحالات أو السطور أو الأحداث اتغيّرت عن الموافقة · مسح الكل والأحداث بالـ cascade · صفر في التلات جداول · بصمات برّه النطاق ثابتة، ولو اتغيّرت جوه المعاملة (حالة مصطنعة) = rollback · الحمايات · فحص شكل المعاملة · md5 الجسم في الـ dry-run = التنفيذ.
- **على Production:** الحصر ← (backup) ← dry-run ← التنفيذ ← الفحص. كل واحدة بأمر.

## ١١) معايير القبول
- CI ناجح بكل الحالات في §١٠ على الـ head المقبول.
- على Production: الحصر = الموافقة وشكل الـ FKs = §٣ · dry-run = نفس الأعداد والبصمات · التنفيذ نجح في معاملة واحدة · الفحص PASS · `idle_tx` = 0.

## ١٢) سجل التعديلات
- **2026-10-10:** المسودة الأولى، من أفكار #111 وقرار المراجع (التنضيف قبل P1، ومفيش مسار يمسح طلبات عليها أوامر فلوس).
- **2026-10-10 · مراجعة #123 على `25ba29e` (3 Blocking):** شكل الـ FKs بالحرف · بصمة الطلبات اللي بتفضل · استرجاع صفوف محددة من الـ backup (على `c46d91c`).
- **2026-10-10 · تبسيط بقرار المراجع الرئيسي:** كل الطلبات بتتمسح (مفيش طلب بيفضل)، فاتشال استرجاع الطلبات المنفردة وبصمة «الطلبات اللي بتفضل». الحمايات: backup كامل · حصر وموافقة المالك على العدد والحالات والأرقام · رفض لو اتغيّرت · فحص الـ FKs (§٣) · معاملة واحدة · بصمة كل الجداول برّه النطاق قبل/بعد · صفر في التلات جداول. الرجوع = الـ backup الكامل. المخزون التجريبي برّه التنضيف ده. شروط تجربة الـ backup على مشروع مجاني (§٩).
