# خريطة الداتابيز

كل دور وجدول ودالة في الداتابيز: بيعمل إيه، ومتعرّف في أنهي ملف. الملفات في `backend/db/` (`schema.sql` و`migrations/`).

- **«اتعرّف في»** = أول ملف عمل الحاجة. الملفات اللي غيّرتها بعد كده مكتوبة جنبها.
- **حالة التطبيق على Production:** المرجع `08-HANDOFF-NOW.md` في zell-skills. ⚠ سطور «الحالة» اللي في راس الملفات و`migrations/README.md` اتكتبت وقت كتابة الملف، وفيها حاجات قديمة.
- **برّه الـ migrations:** فيه حاجات اتعملت من لوحة Supabase / SQL Editor ومالهاش ملف هنا. متعلّم عليها **(برّه الملفات)**، ووصفها في `docs/OPERATIONS.md` و`docs/ADMIN-AUTH.md`.
- أي PR بيضيف أو بيغيّر جدول أو دالة أو دور **يحدّث الملف ده في نفس الـ PR.**
- الأقسام وأرقام السطور في الملفات الكبيرة: `docs/maps/big-files.md`.

---

## ١) الأدوار

| الدور | اتعرّف في | بيعمل إيه |
| --- | --- | --- |
| `anon` · `authenticated` | Supabase | مالهمش أي وصول للجداول (RLS + سحب الصلاحيات في 0002). `authenticated` عنده EXECUTE على ١٢ دالة `zell_erp_*` (0021-P) و٢٣ دالة `zell_inv_session_*` (0020-S PR-1) و١١ دالة `zell_order_*` (0021-A A1) بس |
| `service_role` | Supabase | بيتخطى RLS. اللوحة والمتجر بيقروا بيه من السيرفر بس (حل انتقالي)، وعنده EXECUTE على دوال اللوحة القديمة بس: صفر على أي `zell_inv_*` (من 0020-S PR-3) وعلى جداول 0020. صفر على `erp_*` و`zell_erp_*`. من `zell_order_*`: `zell_order_gate_is_open` بس (trigger الحالة وقت PATCH اللوحة) |
| `postgres` | Supabase | مالك الجداول، واللي بيطبّق الـ migrations (الـ preflight بيتأكد) |
| `zell_definer` | `0005c` (مسودة) | دور مسودة `create_order` القديمة |
| `zell_order_writer` | `0006b` | مالك دوال مسار الطلب (`zell_create_order` · `zell_get_order_receipt`)، ومن غير صلاحيات جداول مباشرة |
| `zell_inventory_definer` | `0020` | مالك دوال المخزون `zell_inv_*`، ومنها `zell_inv_session_*` و`zell_inv_claims_actor` من 0020-S (NOLOGIN · NOBYPASSRLS) |
| `erp_definer` | `0021p_erp_access` | مالك دوال المحرك `erp_*` (NOLOGIN · NOINHERIT · NOBYPASSRLS) |
| `zell_erp_definer` | `0021p_zell_erp_access` | مالك دوال المحوّل والواجهة `erp_actor_status_v1`. مالوش أي صلاحية على `admin_users` |
| `zell_order_definer` | `0021a_a1_order_cycle` | مالك دوال دورة الطلب `zell_order_*` (NOLOGIN · NOINHERIT · NOBYPASSRLS). على `orders`: SELECT + UPDATE لأعمدة الدورة بس |

---

## ٢) الجداول

### المتجر والطلبات

| الجدول | اتعرّف في | بيعمل إيه | اتغيّر في |
| --- | --- | --- | --- |
| `products` | `schema.sql` | المنتجات: سعر المتر والعرض والطول، والقطعة | 0013 `lock_width` · 0014 `compare_at_piastres` · 0016 `sale_unit` `is_listed` `max_quantity` · 0020 trigger بيحمي `sale_unit` |
| `orders` | `schema.sql` | راس الطلب: الزبون والعنوان والإجماليات والحالة | 0005b/0006a idempotency والجلسة والإيصال · 0018 المنطقة والتركيب · 0019 الكوبون والخصم + trigger `orders_cancelled_final` · 0021-A A1: `preparing` و`refused` في قيد الحالة (القديم في تعليق القيد) + `next_follow_up_at` و`delivery_confirmed_date/period/note` + triggers `orders_status_guard` و`orders_created_event` · 0021-D: `preferred_delivery_date/period/note` (لقطة موعد العميل المفضّل) |
| `order_items` | `schema.sql` | سطور الطلب | 0016 `sale_unit` `quantity` |
| `settings` | `schema.sql` | إعدادات ومحتوى بمفتاح (hero · sections · faqs · shipping_rates …) | 0007 شال أسرار تليجرام · 0008 مفتاح `announcement` · 0019 مفتاح `coupons_enabled` |
| `product_images` | `0003` | صور معرض المنتج (`bucket` + `object_path`)، والترتيب والرئيسية | |
| `site_images` | `0006` | اللوجو وصور الموقع | 0009 نوع `hero` + صورة نشطة واحدة لكل نوع فردي |
| `storage_orphans` | `0006` | ملفات Storage محتاجة تنظيف | 0012 سبب `removed` |
| `collections` | `0010` | الأقسام | 0012 `show_on_home` `show_in_nav` والغلاف · 0017 `catalog_layout` |
| `product_collections` | `0010` | ربط المنتجات بالأقسام وترتيبها | |
| `product_widths` | `0015` | عروض الرول الإضافية لكل منتج بسعر المتر بتاعها | |
| `product_addons` | `0016` | الإضافات (منتجات القطعة) لكل فيلم | |
| `coupons` | `0019` | أكواد الخصم | |
| `admin_users` | **(برّه الملفات)** · `docs/ADMIN-AUTH.md` | مين يدخل اللوحة: `user_id` (← `auth.users`، on delete cascade) · `role` owner/admin · `is_active`. RLS من غير policies | 0021-P: ٤ triggers (§٥) |

### دورة الطلب (0021-A A1)

كلها مالكها `postgres`، RLS وpolicy لـ `zell_order_definer` بس، وصفر صلاحيات لـ `anon` و`authenticated` و`service_role`.

| الجدول | اتعرّف في | بيعمل إيه |
| --- | --- | --- |
| `order_status_transitions` | `0021a_a1_order_cycle` | الانتقالات المسموحة (9) وعمود `gate`: `any` · `open` بعد فتح البوابة · `closed` قبلها (`confirmed → shipped`) |
| `order_events` | `0021a_a1_order_cycle` | سجل الطلب append-only (45413). DELETE بس كـ cascade لمسح الطلب. `created` من trigger |
| `order_delivery_periods` | `0021a_a1_order_cycle` | الفترات التلاتة (`morning` · `noon` · `evening`) بتوقيت القاهرة، والمالك بيعدّل الأوقات |
| `zell_order_gate` | `0021a_a1_order_cycle` | البوابة: صف واحد، مقفول افتراضيًا، بيتغيّر بـ `zell_order_set_gate` بس (45414) |
| `zell_order_config_log` | `0021a_a1_order_cycle` | سجل append-only لتغييرات البوابة والفترات (مين · إمتى · من/لـ · الموافقة) |

### المخزون والمشتريات (0020)

| الجدول | بيعمل إيه |
| --- | --- |
| `inventory_locations` | مواقع المخزون (الافتراضي `MAIN`) |
| `suppliers` | الموردين |
| `purchase_docs` | مستند الشراء: `draft` · `posted` · `voided` · `discarded` |
| `purchase_doc_lines` | سطور مستند الشراء |
| `purchase_doc_charges` | مصاريف الشراء المفصّلة اللي بتتوزّع على السطور |
| `opening_stock_docs` · `opening_stock_lines` | رصيد أول المدة |
| `stock_lots` | الـ lots المترحّلة (رول أو دفعة) بتكلفتها |
| `inventory_commands` | idempotency للأوامر (append-only) |
| `inventory_audit_log` | سجل المخزون (append-only) |

- **Sequences:** `purchase_doc_no_seq` · `opening_doc_no_seq` · `roll_lot_seq` · `batch_lot_seq` (أرقام المستندات والـ lots، والفجوات عادية).
- **الصلاحيات:** RLS + policy واحدة للدور `zell_inventory_definer` بس. `service_role` مالوش أي صلاحية على الجداول دي، والقراية والكتابة من الـ RPCs (§٥). مفيش DELETE/TRUNCATE (triggers).

### الصلاحيات (0021-P)

| الجدول | اتعرّف في | بيعمل إيه |
| --- | --- | --- |
| `erp_capabilities` | المحرك | قائمة الصلاحيات (`key` · `category` · `description`)، ٢٩ صلاحية |
| `erp_presets` · `erp_preset_items` | المحرك | القوالب وبنودها (`zell.admin_today` · `zell.warehouse`) |
| `erp_user_grants` | المحرك | المنح الصريح لكل مستخدم |
| `erp_user_access` | المحرك | نسخة صلاحيات كل مستخدم (`version` للتزامن) |
| `erp_commands` | المحرك | النتيجة النهائية لكل `command_id` (append-only) |
| `erp_access_audit` | المحرك | سجل الإدارة (append-only) |
| `erp_access_shadow_events` | المحرك | أحداث الـ shadow مجمّعة باليوم |
| `zell_erp_owner_guard` | المحوّل | صف واحد: عدد الملاك الشغالين |
| `zell_erp_admin_users_log` | المحوّل | كل تغيير على `admin_users` حتى اليدوي (append-only) |

---

## ٣) دوال المتجر والطلب

| الدالة | اتعرّف في | بتعمل إيه |
| --- | --- | --- |
| `generate_order_number()` | `0005a` (مسودة) | رقم الطلب في المسودة القديمة |
| `create_order(…)` | `0005c` (مسودة) | إنشاء الطلب في المسودة القديمة (اتستبدلت بـ `zell_create_order`) |
| `zell_create_order(…)` | `0006b` | إنشاء الطلب ذرّيًا: التسعير، والـ idempotency، والإيصال. **اتعادت كتابتها في** 0006c (`receipt_expires_at`) · 0015 (العروض) · 0016 (القطعة) · 0018 (التركيب والمنطقة، ١٢ معامل) · 0019 (الكوبون) · 0021-D (الموعد المفضّل، ١٤ معامل: `p_preferred_delivery`). بيناديها المتجر (`/api/orders`) |
| `zell_get_order_receipt(…)` | `0006b` | الإيصال بالتوكن. اتعدّلت في 0016 · 0018 · 0019 |
| `zell_preview_coupon(…)` | `0019` | معاينة الكوبون قبل الطلب (`/api/coupons/preview`) |
| `zell_checkout_delivery_periods()` | `0021d` | أوقات فترات التسليم للـ Checkout من `order_delivery_periods` (مالكها `zell_order_definer`، `service_role` بس) |
| `zell_orders_cancelled_final()` | `0019` | دالة الـ trigger `orders_cancelled_final` (BEFORE UPDATE OF status): الإلغاء نهائي، والطلب الملغي مايرجعش (45080)، علشان استخدام الكوبون مايتعدّاش |

## ٤) دوال اللوحة (الكتابة الذرّية)

| الدالة | اتعرّف في | بتعمل إيه |
| --- | --- | --- |
| `zell_save_content(…)` | **(برّه الملفات)**، واتعادت في `0008` | مفاتيح المحتوى + شريط الإعلان، بفحص نسخة (٨ معاملات) |
| `zell_save_shipping(…)` | **(برّه الملفات)** | مفاتيح الشحن |
| `zell_save_identity(…)` | **(برّه الملفات)** | مفاتيح الهوية (من غير `logo_url`) |
| `zell_reorder_products(…)` | **(برّه الملفات)** | ترتيب المنتجات (من ١) |
| `zell_reorder_product_images(…)` | **(برّه الملفات)** | ترتيب صور المعرض (من ٠) |
| `zell_set_primary_product_image(…)` | **(برّه الملفات)** | الصورة الرئيسية |
| `zell_valid_benefits(…)` | **(برّه الملفات)** | فحص شكل `products.benefits` (قيد `products_benefits_shape`) |
| `zell_activate_site_image(…)` | `0009` | تبديل صورة الموقع ذرّيًا (القديمة بتروح `storage_orphans`) |
| `zell_reorder_collections(…)` | `0010`، واتعدّلت في `0012` | ترتيب الأقسام |
| `zell_set_collection_products(…)` | `0010`، واتصلّحت في `0011` | منتجات القسم وترتيبها |
| `zell_create_collection(…)` | `0012` | قسم جديد (أولًا في الترتيب) |
| `zell_set_collection_cover(…)` | `0012` | غلاف القسم |
| `zell_delete_collection(…)` | `0012` | مسح قسم |
| `zell_set_product_widths(…)` | `0015` | عروض الرول للمنتج |
| `zell_set_product_addons(…)` | `0016` | إضافات الفيلم |

- دوال اللوحة دي `security invoker`، والـ EXECUTE عليها لـ `service_role` بس (`docs/OPERATIONS.md`).

## ٥) دوال المخزون (0020، مالكها `zell_inventory_definer`)

- **الحد العام: ٢٣ دالة owner-only** بتاخد `p_actor` وبتتأكد منه في `admin_users` (`zell_inv_assert_owner`).
- ✅ **اتقفل في 0020-S** (PR-1 #109 · PR-2 #110 · PR-3 `0020s_pr3_revoke_service_role.sql`): مفيش `zell_inv_*` لـ `service_role`، والممثل = `sub` الجلسة بس. الفقرة اللي تحت تاريخية.
- ⚠ (تاريخي) **الحماية من السيرفر بس:** الـ ٢٣ (١٤ كتابة · ٩ قراية) EXECUTE لـ `service_role` بس، والممثل `p_actor` بيحدده كود اللوحة
  (غلاف `actionWithAccess` بصلاحية فئة `owner` ← `p_actor = ctx.identity.userId`، عمره ما ييجي من الفورم)، مش جلسة المستخدم. ده نفس نمط
  `p_actor` اللي 0021-P قفلته في دوالها. **القرار (2026-10-08، `10-DECISIONS.md` في zell-skills):** عقد لوحده لنقلها لهوية الجلسة،
  بعد 0021-P ب2 وقبل الإطلاق، ومش مشروط بتشغيل shadow أو enforce ولا بصفحة إدارة الصلاحيات (`docs/contracts/0021-P-code.md` §٨ بند 4).
- **0020-S PR-1 (`0020s_inv_session.sql`، إضافة بس):** ٢٣ دالة `zell_inv_session_<x>` بنفس معاملات `zell_inv_<x>` ناقص `p_actor`
  (أسماء مختلفة، مفيش overload). الممثل = `sub` الجلسة من `zell_inv_claims_actor()` (داخلية، بشرط `role = authenticated`)، وبتنادي الدالة
  القديمة بيه، وفحص المالك زي ما هو (`zell_inv_assert_owner`). EXECUTE لـ `authenticated` بس. الدوال القديمة وصلاحياتها زي ما هي:
  من PR-2 اللوحة بتنادي `zell_inv_session_*` بجلسة المستخدم بس (`apps/admin/lib/inventory/rpc.ts`). من PR-3 (`0020s_pr3_revoke_service_role.sql`)
  القديمة داخلية (EXECUTE لمالكها بس) ومابتتمسحش. العقد: `docs/contracts/0020-S.md`.
  ملفي 0020 القديمين صالحين مع 0020-S: الـ verify بيكتب `0020s=applied`، والـ rollback بيرفض بـ `ZELL_0020_ROLLBACK_0020S_FIRST` لحد rollback 0020-S الأول.

| المجموعة | الدوال |
| --- | --- |
| المواقع | `zell_inv_create_location` · `zell_inv_update_location` · `zell_inv_list_locations` |
| الموردين | `zell_inv_create_supplier` · `zell_inv_update_supplier` · `zell_inv_list_suppliers` |
| الشراء | `zell_inv_create_purchase` · `zell_inv_update_purchase` · `zell_inv_post_purchase` (ترحيل لـ lots) · `zell_inv_discard_purchase` (مسح مسودة) · `zell_inv_void_purchase` (إلغاء مترحّل) · `zell_inv_list_purchases` · `zell_inv_get_purchase` · `zell_inv_preview_purchase` (التوزيع والتكلفة قبل الترحيل) |
| أول المدة | `zell_inv_create_opening` · `zell_inv_update_opening` · `zell_inv_post_opening` · `zell_inv_discard_opening` · `zell_inv_void_opening` · `zell_inv_list_openings` · `zell_inv_get_opening` · `zell_inv_preview_opening` |
| الـ lots | `zell_inv_list_lots` |
| الجلسة (0020-S، EXECUTE لـ `authenticated`) | `zell_inv_session_*` (٢٣، واحدة لكل دالة فوق بنفس الاسم بعد `zell_inv_`) |
| مساعدة داخلية | `zell_inv_claims_actor` (0020-S: `sub` الجلسة أو NULL) · `zell_inv_assert_owner` (المالك الشغال) · `zell_inv_lock_products` · `zell_inv_read_products` · `zell_inv_product_has_stock_refs` · `zell_inv_width_allowed` · `zell_inv_allocate_lr` (توزيع largest remainder) · `zell_inv_normalize_purchase` · `zell_inv_normalize_opening` · `zell_inv_command_check` (idempotency) · `zell_inv_doc_void_blockers` · `zell_inv_unknown_lot_references` · `zell_inv_void_contract_version` |
| دوال الـ triggers (مالكها `postgres`) | `zell_inv_trg_no_delete` · `zell_inv_trg_no_truncate` · `zell_inv_trg_append_only` · `zell_inv_trg_doc_guard` · `zell_inv_trg_child_insert_guard` · `zell_inv_trg_lot_update_guard` · `zell_inv_trg_master_guard` · `zell_inv_trg_products_sale_unit` |

- **Triggers:** `zinv_no_delete` · `zinv_no_truncate` · `zinv_doc_guard` · `zinv_child_insert_guard` · `zinv_append_only` · `zinv_lot_update_guard` · `zinv_master_guard` · `zinv_products_sale_unit` (على `products`).

## ٦) دوال الصلاحيات (0021-P)

التفاصيل والعقد: `docs/contracts/0021-P.md`.

### المحرك (`0021p_erp_access.sql`، مالكها `erp_definer`، كلها داخلية)

| المجموعة | الدوال |
| --- | --- |
| الواجهة | `erp_actor_status_v1(uuid)` (المحوّل بيستبدل جسمها) · `erp_actor_status_contract_version()` · `erp_actor_status(…)` (بتنادي الواجهة وبتتأكد من الشكل، وإلا 45309) |
| الصلاحيات الفعلية | `erp_effective_capabilities` · `erp_has_capability` · `erp_require_capability` |
| الإدارة | `erp_access_grant` · `erp_access_revoke` · `erp_access_apply_preset` · `erp_access_revoke_all` |
| القراءة | `erp_access_snapshot` · `erp_access_audit_page` · `erp_access_shadow_report` |
| الـ shadow | `erp_record_shadow_event` |
| مساعدة داخلية | `erp_access_request_hash` (بصمة الأمر) · `erp_access_command_begin` · `erp_access_command_finish` (idempotency) · `erp_access_lock_user` · `erp_access_user_version` · `erp_access_bump` (النسخة) · `erp_access_user_keys` · `erp_access_preset_keys` · `erp_access_target_check` · `erp_access_denial` · `erp_access_reason` |
| الـ triggers | `erp_trg_immutable` (append-only / no truncate على جداول المحرك) |

### المحوّل (`0021p_zell_erp_access.sql`)

| المجموعة | الدوال |
| --- | --- |
| **الحد العام** (EXECUTE لـ `authenticated`) | `zell_erp_my_access` · `zell_erp_access_grant` · `zell_erp_access_revoke` · `zell_erp_access_apply_preset` · `zell_erp_access_revoke_all` · `zell_erp_set_user_active` · `zell_erp_access_snapshot` · `zell_erp_access_users` · `zell_erp_access_audit_page` · `zell_erp_access_parity` · `zell_erp_access_shadow_report` · `zell_erp_record_shadow_event` |
| الهوية | `zell_erp_trusted_actor()` (`sub` من `request.jwt.claims` بدور `authenticated`) · `zell_erp_require_actor()` (لازم صف في `admin_users`، وإلا 45300) |
| مساعدة على `admin_users` (مالكها `postgres`) | `zell_erp_admin_status` · `zell_erp_admin_set_active` · `zell_erp_admin_list` · `zell_erp_owner_guard_lock` · `zell_erp_owner_guard_read` |
| دوال الـ triggers | `zell_erp_owner_guard_count` · `zell_erp_admin_users_log_change` · `zell_erp_admin_users_user_id_immutable` · `zell_erp_admin_users_no_truncate` · `zell_erp_owner_guard_no_direct` · `zell_erp_trg_immutable` |

### Triggers 0021-P

| الجدول | الـ triggers |
| --- | --- |
| `admin_users` | `zell_erp_admin_users_user_id_immutable` (BEFORE UPDATE، 45310) · `zell_erp_owner_guard_count` (AFTER ROW، 45303) · `zell_erp_admin_users_log_change` (AFTER ROW) · `zell_erp_admin_users_no_truncate` (45311) |
| `zell_erp_owner_guard` | `zell_erp_owner_guard_no_direct` (45312) · `zell_erp_owner_guard_no_truncate` |
| `zell_erp_admin_users_log` | `zell_erp_admin_users_log_immutable` · `zell_erp_admin_users_log_no_truncate` |
| جداول المحرك | `erp_commands_immutable` · `erp_access_audit_immutable` (45315) · `*_no_truncate` على الجداول الـ ٨ |

---

## ٧) دوال دورة الطلب (0021-A A1، مالكها `zell_order_definer`)

التفاصيل: `docs/contracts/0021-A.md` §١٤. الهوية من الجلسة + `admin_users`، من غير `p_actor`. الأكواد 45400..45414.

| المجموعة | الدوال |
| --- | --- |
| عامة (EXECUTE لـ `authenticated` بس) | `zell_order_transition` · `zell_order_record_call` · `zell_order_set_follow_up` · `zell_order_set_confirmed_delivery` · `zell_order_edit_details` · `zell_order_set_internal_note` · `zell_order_events` · `zell_order_delivery_periods` · `zell_order_save_delivery_periods` (المالك) · `zell_order_gate_state` · `zell_order_set_gate` (المالك + موافقة) |
| مساعدة داخلية | `zell_order_claims_actor` · `zell_order_actor` · `zell_order_lock` (قفل + فحص `updated_at`) · `zell_order_text` · `zell_order_apply_transition` · `zell_order_result` · `zell_order_gate_is_open` (EXECUTE لـ `postgres` و`service_role` علشان الـ trigger) |
| مالكها `postgres` | `zell_order_admin_role` (دور الممثل من `admin_users`) · `zell_order_trg_status_guard` · `zell_order_trg_append_only` · `zell_order_trg_events_immutable` · `zell_order_trg_gate_guard` |
| trigger | `zell_order_trg_created_event` |

- **Triggers:** على `orders`: `orders_status_guard` (البوابة مقفولة: الحالتين الجداد 45406 · مفتوحة: أي تغيير مباشر للحالة 45407) · `orders_created_event`. على السجلات والبوابة: `order_events_immutable` · `order_events_no_truncate` · `zell_order_config_log_immutable` · `zell_order_config_log_no_truncate` · `zell_order_gate_guard` · `zell_order_gate_no_truncate`.

## ٨) ملفات من غير جداول أو دوال جديدة

| الملف | بيعمل إيه |
| --- | --- |
| `0002_security_rls_grants.sql` | تشغيل RLS، وسحب صلاحيات `anon` و`authenticated`، وbucket الصور |
| `0004_harden_default_privileges.sql` | إلغاء الصلاحيات الافتراضية لأي كائن جديد (ومنها PUBLIC) |
| `0005b_order_idempotency.sql` · `0006a_order_columns.sql` | أعمدة الطلب: idempotency والجلسة والإيصال |
| `0007_cleanup_notify_secrets.sql` | مسح أسرار تليجرام من `settings` (بقت متغيرات بيئة) |
| `0008a_align_announcement_version.sql` | مزامنة طابع `announcement` مع باقي مفاتيح المحتوى |
| `0013` · `0014` · `0017` | أعمدة: `lock_width` · `compare_at_piastres` · `catalog_layout` |

- ملفات `*_ptest.sql` و`*_verify.sql` و`*_rollback.sql` مابتعملش كائنات دايمة. الـ ptest والـ verify بيرجعوا، والـ rollback بيشيل.
