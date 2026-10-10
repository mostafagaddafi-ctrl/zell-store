# عقد تنضيف التجارب قبل الإطلاق (CLEAN-prelaunch)

> ⚠ **مسودة للمراجعة — ممنوع التنفيذ.** مفيش SQL ولا أي تشغيل على Production (حتى القراية) قبل اعتماد العقد، وكل خطوة على Production بأمر صريح منفصل من المالك.

| | |
| --- | --- |
| الحالة | مسودة للمراجعة، على main `9527e47` (بعد #122) |
| الأساس | أفكار وصف #111 (المقفول من غير دمج، والفرع `docs/prelaunch-cleanup-contract` مصدر) · `10-DECISIONS.md` («المتجر لسه ما اتطلقش: كل الطلبات تجارب») · قرار المراجع 2026-10-10 |
| الترتيب | **قبل تطبيق 0021-A P1** (قرار المراجع)، وبعده P1 ← P2 ← … ← A3 (منع DELETE على `orders` و`order_items`) |
| المستوى | كامل (مسح بيانات على Production) |
| أصغر من CLEAN القديم | الطلبات بس. حذف مسودات المخزون والتنضيف داخل المخزون برّه العقد ده |

## ١) القواعد الحاكمة
1. **مرة واحدة قبل الإطلاق.** مش زرار ولا دالة دايمة ولا migration: سكربتات تشغيل تحت `backend/db/ops/`.
2. **مفيش أي مسار بيمسح طلب عليه أوامر فلوس.** التنفيذ قبل P1 بس: الـ preflight بيرفض لو `order_payments` أو `zell_payment_commands` موجودين (`ZELL_CLEAN_P1_APPLIED`). وبعد P1 الـ FK restrict بيمنعه أصلًا.
3. **قايمة صريحة من المالك** بأرقام الطلبات اللي هتتمسح (`FLM-…`). أي طلب مش في القايمة بيفضل، حتى لو جه بعد الحصر.
4. **مفيش أي تعديل** على الصفوف اللي بتفضل، ومفيش إيقاف لأي trigger في التنفيذ.
5. **الرجوع جاهز ومتجرّب قبل المسح** (§٥): ممنوع التنفيذ قبل ما تجربة الاسترجاع بالـ backup الحقيقي تنجح، وممنوع نعتمد على استرجاع الداتابيز كلها.
6. **كل السكربتات بـ `set local timezone = 'UTC'`** علشان البصمات تبقى deterministic.

## ٢) النطاق
| | |
| --- | --- |
| **بيتمسح** | الطلبات اللي في القايمة بس · سطورها (`order_items`) · أحداثها (`order_events`، بالـ cascade اللي A1 سمح بيه علشان التنضيف) |
| **بيفضل (ومتقارن قبل/بعد)** | أي طلب مش في القايمة (ببصمة كاملة — §٤) · المنتجات والعروض والإضافات والأقسام · `settings` · الصور (`product_images` · `site_images`) · تعريف الكوبونات · `admin_users` وجداول 0021-P · بوابة الطلبات وسجلها وفترات التسليم · المخزون (0020) كله |
| **برّه النطاق** | المخزون: الحصر بيعدّه بس، ولو فيه أي بيانات غير موقع `MAIN` نقف ونقرر بعقد لوحده (triggers 0020 بتمنع المسح) · Storage · العدّادات والـ sequences (مابترجعش لـ 1) · رسايل تيليجرام اللي اتبعتت |

**أثر جانبي معروف:** استخدام الكوبون بيتحسب من الطلبات، فمسح طلب عليه كوبون بيحرّر استخدامه (ولو مفيش طلب تاني عليه، قفل الكود والنوع ممكن يتفك). والإيصال لطلب ممسوح بيرجّع «مش موجود».

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
- **شكل الحذف:** `delete` صريح من `order_items` للطلبات دي الأول (علشان العدد يتعدّ ويتقارن)، وبعدين `delete` من `orders`، والأحداث بالـ cascade بس (`zell_order_trg_events_immutable` بيسمح بالـ DELETE بس لما الطلب نفسه يكون اتمسح). مفيش `delete` مباشر على `order_events`.

## ٤) البصمات (deterministic — نفس الاستعلام قبل وبعد بالحرف)
- **بصمة كل طلب** = md5 لـ: كل أعمدة الطلب (`to_jsonb(o)`) + كل سطوره (`to_jsonb(i)` مرتبة بـ `i.id`) + كل أحداثه (`to_jsonb(e)` مرتبة بـ `e.id`).
- **بصمة «بيفضل»** = العدد + md5 لبصمات كل الطلبات اللي برّه القايمة مرتبة بـ `o.id`. و**بصمة «بيتمسح»** = نفس الشي للطلبات اللي في القايمة (بتتقارن بالـ backup — §٥).
- **الاستعلام المرجعي** (يتكتب بالحرف في PR التنفيذ، والقايمة في `zell.clean_orders` مفصولة بفاصلة):

```sql
with lst as (
  select pg_catalog.btrim(x) as order_number
    from pg_catalog.unnest(pg_catalog.string_to_array(pg_catalog.current_setting('zell.clean_orders'), ',')) as x
), fp as (
  select o.id,
         (o.order_number in (select order_number from lst)) as listed,
         pg_catalog.md5(
           pg_catalog.to_jsonb(o)::text
           || coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by i.id)
                          from public.order_items i where i.order_id = o.id)::text, '[]')
           || coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.id)
                          from public.order_events e where e.order_id = o.id)::text, '[]')) as h
    from public.orders o
)
select (select count(*) from fp where not listed) as kept_orders,
       pg_catalog.md5(coalesce((select string_agg(h, '|' order by id) from fp where not listed), '')) as kept_fp,
       (select count(*) from fp where listed) as listed_orders,
       pg_catalog.md5(coalesce((select string_agg(h, '|' order by id) from fp where listed), '')) as listed_fp;
```

- **في التنفيذ:** البصمة بتتحسب في الـ preflight وتتحفظ (`set_config(…, true)`)، وبتتحسب تاني بعد المسح جوه نفس المعاملة. أي اختلاف في `kept_orders` أو `kept_fp` = exception قبل الـ commit (`ZELL_CLEAN_KEPT_CHANGED`). والفحص بعد بيقارنها بقيمة الـ dry-run.
- **باقي «بيفضل»** (المنتجات والعروض والإضافات والأقسام · `settings` · الصور · الكوبونات · `admin_users` · المخزون · 0021-P): عدد + md5 لـ `to_jsonb` الصفوف مرتبة بالمفتاح، بنفس الأسلوب.

## ٥) الرجوع: استرجاع الصفوف المحددة بس من الـ backup (جاهز ومتجرّب قبل المسح)
- **ممنوع** استرجاع الداتابيز كلها (بيضيّع أي حاجة حصلت بعد التنضيف)، و**ممنوع** نكتشف طريقة الرجوع بعد المسح.
- **الملفات** (في PR التنفيذ):
  - `clean_prelaunch_extract.sql`: بيشتغل على نسخة الـ backup في داتابيز مؤقتة بس (مش Production)، وبيطلّع سكربت استرجاع deterministic للطلبات اللي في القايمة: `orders` و`order_items` و`order_events` (بالـ ids الأصلية، و`overriding system value` للأحداث)، ومعاه `listed_fp` محسوب من الـ backup.
  - `clean_prelaunch_restore.sql`: معاملة واحدة. preflight بيرفض لو أي id أو رقم طلب موجود · أي منتج أو كوبون مربوط مش موجود · شكل الـ FKs مختلف (§٣). trigger `orders_created_event` بس بيتوقف جوه نفس المعاملة (علشان مايتكررش حدث الإنشاء، والحدث الأصلي راجع من الـ backup) ويرجع قبل الـ commit، والـ postflight بيرفض لو مارجعش شغال · بعد الإدخال `listed_fp` = قيمة الـ extract بالحرف، و`kept_fp` مااتغيّرش، وإلا مفيش commit. لو P1 اتطبّق بعدها، الأعمدة الجديدة بقيمها الافتراضية (0)، والبصمة بتتحسب على أعمدة الـ backup بس.
- **التجربة قبل المسح (شرط للخطوة ٦):**
  1. **CI على Postgres 17 مؤقت:** داتابيز تجربة ← `pg_dump` ← تنضيف ← extract من الـ dump في داتابيز تانية ← restore ← `listed_fp` و`kept_fp` = قبل · رفض الـ restore لو الصفوف موجودة · الـ trigger رجع شغال · الـ restore بعد P1 كمان.
  2. **بالـ backup الحقيقي** (بتاع الخطوة ٣) على مشروع Supabase مجاني منفصل، مش Production: استرجاع الـ backup هناك ← التنضيف ← extract ← restore ← البصمات = قبل، و`listed_fp` من الـ backup = `listed_fp` من الـ dry-run على Production (يعني الـ backup فيه نفس الصفوف بالظبط). مين بيشغّل وإزاي (المالك من SQL Editor أو resource منفصل للمشروع المجاني) بيتحدد في PR التنفيذ.
  3. **لو استرجاع الـ backup نفسه على المشروع المجاني فشل** (مثلًا الأدوار)، نقف. ده بيرتبط بمهمة «تجربة الرجوع من الـ backup» في `09-ROADMAP.md`.

## ٦) الخطوات (كل خطوة على Production بأمر منفصل من المالك)
1. **الحصر (قراية بس):** أعداد بس من غير أي بيانات زباين: الطلبات (العدد · بكل حالة · أول وآخر تاريخ · أرقام الطلبات) · `order_items` · `order_events` · الكوبونات المستخدمة · جداول المخزون بالعدد · وجود جداول P1 · **استعلام الـ FKs (§٣)** · `idle_tx`.
2. **القايمة:** المالك بيحدد الحقيقي من التجربة ويبعت أرقام طلبات التجربة. الموافقة بتتكتب بالقايمة والعدد بالظبط، واسمها `owner-approval-YYYY-MM-DD-prelaunch-clean`.
3. **backup** كامل جديد عند المالك.
4. **dry-run:** نفس جسم التنفيذ بالحرف بين `begin` و`rollback` (CI بيثبت md5 الجسم)، والنتيجة صفوف في SELECT واحد: هيتمسح كام من كل جدول · هيفضل كام · `kept_fp` · `listed_fp` · باقي البصمات · شكل الـ FKs.
5. **تجربة الرجوع بالـ backup ده** (§٥ بند ٢) = PASS. **من غيرها مفيش خطوة ٦.**
6. **التنفيذ — معاملة واحدة:** سطر الموافقة والقايمة والعدد المتوقع و`kept_fp`/`listed_fp` من الـ dry-run بـ `set local` بعد `begin` (برّه الجسم).
   - **preflight بيرفض لو:** P1 متطبّق · شكل الـ FKs مختلف أو فيه FK جديد (§٣) · أي رقم في القايمة مش موجود أو متكرر · العدد مختلف · `listed_fp` أو `kept_fp` مختلفين عن الـ dry-run · `idle_tx` ≠ 0.
   - **الجسم:** §٣ «شكل الحذف».
   - **postflight بيرفض الـ commit لو:** فاضل أي طلب من القايمة · `kept_orders`/`kept_fp` اتغيّروا · أي بصمة «بيفضل» تانية اتغيّرت · أي حماية مش شغالة (§٧).
7. **الفحص بعد (verify، قراية بس)** — §٧.
8. بعدها خطة P1 ثم P2 في `08-HANDOFF-NOW.md` زي ما هي، وبعدين A3.

## ٧) الفحص بعد
- **صفر تجارب:** ولا طلب من القايمة موجود.
- **مفيش صفوف يتيمة:** `order_items` و`order_events` من غير طلب = 0.
- **اللي بيفضل زي ما هو:** `kept_orders` و`kept_fp` (§٤) = الـ dry-run بالحرف · باقي بصمات «بيفضل» = قبل.
- **الحمايات شغالة:** شكل الـ FKs (§٣) زي ما هو · triggers `orders_cancelled_final` · `orders_status_guard` · `orders_created_event` · `order_events_immutable` · `order_events_no_truncate` · triggers المخزون، كلها enabled · DELETE مباشر على `order_events` لسه مرفوض · بصمة `zell_create_order` = `c131cb51cd86830e9445b139296b0281` · البوابة زي ما هي · RLS والصلاحيات زي ما هي · verify A1 وD و0021-P = PASS.
- **استعلام الأثر قبل/بعد** (نصّه بالحرف في وصف PR التنفيذ): الفرق في الطلبات والسطور والأحداث بس بالأعداد المعتمدة، و`idle_tx` = 0.

## ٨) التنفيذ (PR الجاي — مش في الـ PR ده)
- `backend/db/ops/clean_prelaunch_count.sql` (الحصر) · `clean_prelaunch.sql` (التنفيذ، والـ dry-run بنفس الجسم) · `clean_prelaunch_verify.sql` · `clean_prelaunch_extract.sql` · `clean_prelaunch_restore.sql`.
- **CI على Postgres 17 مؤقت** (قاعدة المالك: الحالات الكبيرة هنا، وProduction smoke بس): رفض بعد P1 · رفض FK بشكل مختلف (كل خانة) أو FK جديد · رفض قايمة فيها رقم غلط أو متكرر أو عدد مختلف · رفض لو `kept_fp`/`listed_fp` مختلفين · مسح القايمة بس · cascade الأحداث · مفيش يتامى · `kept_fp` ثابت · الحمايات · فحص شكل المعاملة · md5 الجسم في الـ dry-run = التنفيذ · **مسار الاسترجاع كامل** (§٥ بند ١).
- **على Production:** الحصر ← dry-run ← التنفيذ ← الفحص. كل واحدة بأمر. (تجربة الاسترجاع بالـ backup الحقيقي على المشروع المجاني، مش Production.)

## ٩) معايير القبول
- CI ناجح بكل الحالات في §٨ على الـ head المقبول.
- تجربة الاسترجاع بالـ backup الحقيقي PASS قبل التنفيذ.
- على Production: الحصر = القايمة المعتمدة وشكل الـ FKs = §٣ · dry-run = نفس الأعداد والبصمات · التنفيذ نجح في معاملة واحدة · الفحص PASS · `idle_tx` = 0.

## ١٠) سجل التعديلات
- **2026-10-10:** المسودة الأولى، من أفكار #111 وقرار المراجع (التنضيف قبل P1، ومفيش مسار يمسح طلبات عليها أوامر فلوس).
- **2026-10-10 · مراجعة #123 على `25ba29e` (3 Blocking):** §٣ شكل الـ FKs بالحرف والاستعلام والمتوقع، وأي اختلاف أو FK جديد يوقف · §٤ بصمة كاملة لكل طلب بيفضل (كل الأعمدة + سطوره + أحداثه) باستعلام مرجعي، ونفسه قبل وبعد، وأي اختلاف يمنع الـ commit · §٥ استرجاع الصفوف المحددة بس من الـ backup، مكتوب ومتجرّب (CI + الـ backup الحقيقي على مشروع مجاني) **قبل** المسح. الخطوات بقت ٨ (تجربة الرجوع قبل التنفيذ).
