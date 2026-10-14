# الملفات الضخمة: أقسامها وأرقام سطورها

كل ملف في الريبو حجمه 20 KB أو أكتر (SQL · shell · Markdown)، وأقسامه بأرقام سطورها، ومعاهم ملفات 0021-A P1/P2 و0021-D2 الأصغر علشان المرحلة تبقى كاملة. الهدف إن أي شات يقرا الجزء اللي محتاجه بس، من غير ما يفتح ملف فيه آلاف السطور.

- **الأرقام دي من head الـ PR اللي حدّث الملف ده** (تنضيف التجارب قبل الإطلاق — السكربتات وCI، فوق main `0d6465b`). الجدول كله اتحسب من جديد (الحجم والسطور)، وأي قسم قديم اتأكد سطر بسطر: لو أي سطر اتحرّك، القسم اتولّد من جديد. أي PR بيغيّر ملف من دول يحدّث جدوله هنا في نفس الـ PR. ملفات 0021-D2 W1 (`0021d2_*`) اتضافت في PR W1 فوق main `6f3df51` (صفوفها وأقسامها من الـ head بتاعه)، وباقي الجدول زي ما هو. و`docs/plans/ADMIN-LANG-LIST.md` اتضاف في PR الحصر فوق main `c760822`. وملفات 0021-TR W1 (`0021tr_*`) اتضافت في PR W1 (#145) فوق main `3658906` (صفوفها وأقسامها من الـ head بتاعه)، وقسم `docs/maps/db-map.md` اتولّد من جديد من نفس الـ head (كان قديم: من غير §٧-ج و§٩). وعقدي `EXPRESS-SHIPPING.md` و`TRACK-ORDER-v2.md` اتضافوا في PR العقود (#147) فوق main `c825ce3` (صفوفهم وأقسامهم من الـ head بتاعه). وملفات EXPRESS-SHIPPING W1 (`0021ex_*`) اتضافت في PR W1 فوق main `30971d2` (صفوفها وأقسامها من الـ head بتاعه)، وصفوف وأقسام `0021a_p1_payments_verify.sql` و`docs/maps/db-map.md` و`docs/contracts/EXPRESS-SHIPPING.md` اتحدّثت من نفس الـ head. وفي PR W2 فوق main `baa66a5`: صفوف وأقسام `backend/db/ci/0021ex_sql_ci.sh` (S46) و`docs/contracts/EXPRESS-SHIPPING.md` (§٧-٣) اتحدّثت من الـ head بتاعه. وملفات TRACK-ORDER v2 W1 (`0021tr2_*`) اتضافت في PR W1 فوق main `7c68bb5` (صفوفها وأقسامها من الـ head بتاعه)، وصفوف وأقسام `0021tr_track_order_verify.sql` و`0021tr_track_order_rollback.sql` و`0021ex_express_shipping_rollback.sql` و`docs/contracts/TRACK-ORDER-v2.md` و`docs/maps/db-map.md` اتحدّثت من نفس الـ head.
- **القراية بالسطور:** على GitHub ضيف `#L100-L200` للرابط، أو اقرا الـ blob وقطّع السطور من القسم لحد القسم اللي بعده.
- **الـ ptest:** جسم الـ migration منسوخ جواه بالحرف بين «بداية/نهاية الجسم المنسوخ»، فمش محتاج تقراه هناك. اقراه من ملف الـ migration.
- الجداول متولّدة من عناوين الملفات نفسها: `-- (N)` · الفواصل · `DO $…$` · `create function/table/role` · `BEGIN/COMMIT/ROLLBACK` · `#` في Markdown · `name() {` و`X=$(cat <<'SQL'` في shell.
- الملف ده نفسه (`docs/maps/big-files.md`) مش في الجدول.

| الملف | الحجم | السطور | بيعمل إيه |
| --- | --- | --- | --- |
| `backend/db/ci/0020s_sql_ci.sh` | 36 KB | 515 | اختبارات SQL لـ 0020-S في CI (ptest · تطبيق · verify · نداءات زي PostgREST · rollback) |
| `backend/db/ci/0021a_sql_ci.sh` | 39 KB | 537 | اختبارات SQL لـ 0021-A A1 في CI (S0–S13: ptest · تطبيق · البوابة قبل/بعد · rollback · اتصالين) |
| `backend/db/ci/0021d2_flows.sql` | 15 KB | 248 | 0021-D2 W1 سيناريوهات الإعداد بعد التطبيق في CI (F01–F32، 24 حالة، معاملة بترجع) — أقل من 20 KB |
| `backend/db/ci/0021d2_sql_ci.sh` | 14 KB | 212 | اختبارات SQL لـ 0021-D2 W1 في CI فوق شكل Production (S0–S5: الشكل · ptest · تطبيق · verify · السيناريوهات · rollback · حراس الـ preflight) — أقل من 20 KB |
| `backend/db/ci/0021d_sql_ci.sh` | 28 KB | 391 | اختبارات SQL لـ 0021-D في CI (ptest · تطبيق · مقارنة قديم/جديد 480 حالة · الإيصال · rollback · الانحراف) |
| `backend/db/ci/0021ex_flows.sql` | 31 KB | 439 | EXPRESS-SHIPPING W1 سيناريوهات الإعداد والطلب بعد التطبيق في CI (F01–F42، 38 حالة، معاملة بترجع) |
| `backend/db/ci/0021ex_sql_ci.sh` | 41 KB | 506 | اختبارات SQL لـ EXPRESS-SHIPPING W1 في CI فوق شكل Production (S0–S6: الشكل والأكواد والفرق عن P1 · ptest · تطبيق · الأثر · verify بالحالتين · مقارنة 520 حالة × 4 نداءات · السيناريوهات · قيد اللقطة · rollback ببصمات R1 · حراس الـ preflight · S46 شحن العرض من packages/core = الداتابيز) |
| `backend/db/ci/0021p_sql_ci.sh` | 30 KB | 445 | اختبارات SQL لـ 0021-P في CI (S0–S8 و C1–C4) |
| `backend/db/ci/0021p1_flows.sql` | 37 KB | 538 | 0021-A P1 سيناريوهات الدفع بعد التطبيق في CI (F01–F42، معاملة بترجع) |
| `backend/db/ci/0021p1_sql_ci.sh` | 56 KB | 748 | اختبارات SQL لـ 0021-A P1 و P2 وتنضيف التجارب في CI، بتتشغّل مرتين (مالك zell_create_order = zell_order_writer ثم postgres): ptest · تطبيق · verify · مقارنة 520 حالة · الرسوم DB = core · السيناريوهات · rollback · الانحراف · التنضيف C00–C12 · ptest من غير أدمن ولا طلبات |
| `backend/db/ci/0021tr2_flows.sql` | 43 KB | 605 | TRACK-ORDER v2 W1 سيناريوهات الشحنة ورسايل العميل ورد التتبّع بعد التطبيق في CI (F00–F48، 34 حالة، معاملة بترجع) |
| `backend/db/ci/0021tr2_sql_ci.sh` | 43 KB | 529 | اختبارات SQL لـ TRACK-ORDER v2 W1 في CI فوق شكل Production (S0–S7: الشكل والأكواد والأجسام · ptest · تطبيق · الأثر · verify بالحالتين · السيناريوهات · بيانات حقيقية ورفض الرجوع · التزامن بجلستين · rollback ببصمات T1 · حراس الـ preflight · توافق حارس v1) |
| `backend/db/ci/0021tr_sql_ci.sh` | 22 KB | 313 | اختبارات SQL لـ 0021-TR W1 في CI فوق شكل Production (S0–S5: الشكل · ptest · تطبيق · verify · الرد بالسبع حالات والموعد والسطور ومن غير بيانات عميل · null للشكل الغلط · الصلاحيات · rollback · حراس الـ preflight) |
| `backend/db/migrations/0006b_order_functions.sql` | 38 KB | 765 | دور `zell_order_writer` وأول نسخة من `zell_create_order` و`zell_get_order_receipt` |
| `backend/db/migrations/0006c_order_receipt_expiry.sql` | 23 KB | 504 | `zell_create_order` بترجّع `receipt_expires_at` |
| `backend/db/migrations/0015_product_widths.sql` | 21 KB | 463 | عروض الرول (`product_widths`) + `zell_create_order` |
| `backend/db/migrations/0016_piece_products_rollback.sql` | 20 KB | 451 | الرجوع من 0016 |
| `backend/db/migrations/0016_piece_products.sql` | 26 KB | 575 | منتجات القطعة والإضافات + `zell_create_order` والإيصال |
| `backend/db/migrations/0018_installation_fee_ptest.sql` | 514 KB | 10206 | اختبار 0018: dry-run للـ migration مرتين + الرجوع، و61 حالة على 5 مجموعات |
| `backend/db/migrations/0018_installation_fee_rollback.sql` | 25 KB | 557 | الرجوع من 0018 |
| `backend/db/migrations/0018_installation_fee.sql` | 34 KB | 738 | فني التركيب والمنطقة + `zell_create_order` (١٢ معامل) والإيصال |
| `backend/db/migrations/0019_coupons_ptest.sql` | 384 KB | 7518 | اختبار 0019 |
| `backend/db/migrations/0019_coupons_rollback.sql` | 31 KB | 684 | الرجوع من 0019 |
| `backend/db/migrations/0019_coupons.sql` | 47 KB | 988 | أكواد الخصم: `coupons` وأعمدة الطلب و`zell_create_order` و`zell_preview_coupon` والإلغاء النهائي |
| `backend/db/migrations/0020_inventory_purchasing_ptest.sql` | 306 KB | 5439 | اختبار 0020 (الجسم منسوخ بين علامات >>> و <<<) |
| `backend/db/migrations/0020_inventory_purchasing_verify.sql` | 29 KB | 397 | التحقق بعد تطبيق 0020 |
| `backend/db/migrations/0020_inventory_purchasing.sql` | 219 KB | 4065 | المخزون والمشتريات: الدور والجداول والـ 23 RPC والـ triggers |
| `backend/db/migrations/0020s_inv_session_ptest.sql` | 61 KB | 1150 | 0020-S PR-1 اختبار قبل التطبيق (الجسم منسوخ بالحرف، والنتيجة صفوف) |
| `backend/db/migrations/0020s_inv_session.sql` | 30 KB | 579 | 0020-S PR-1: 23 دالة `zell_inv_session_*` بهوية الجلسة |
| `backend/db/migrations/0020s_pr3_ptest.sql` | 22 KB | 392 | 0020-S PR-3 اختبار سحب `service_role` من `zell_inv_*` |
| `backend/db/migrations/0021a_a1_order_cycle_ptest.sql` | 67 KB | 1233 | 0021-A A1 اختبار قبل التطبيق (الجسم منسوخ بالحرف، والنتيجة صفوف) |
| `backend/db/migrations/0021a_a1_order_cycle.sql` | 47 KB | 892 | 0021-A A1 دورة الطلب: الحالتين ورا البوابة · الانتقالات · السجل · الفترات · 11 دالة بالجلسة |
| `backend/db/migrations/0021a_p1_payments_ptest.sql` | 166 KB | 2988 | 0021-A P1 اختبار قبل التطبيق (الجسم + zell_create_order الحالية بالحرف، والنتيجة صفوف؛ الـ skips من البيانات والحكم بالعدد) |
| `backend/db/migrations/0021a_p1_payments_rollback.sql` | 44 KB | 885 | 0021-A P1 الرجوع (zell_create_order من D ودالة الانتقال من A1 بالحرف؛ بيرفض بفلوس أو أوامر أو سطر إعدادات أو P2 متطبّق) |
| `backend/db/migrations/0021a_p1_payments_verify.sql` | 14 KB | 171 | 0021-A P1 التحقق بعد التطبيق (النتيجة صفوف؛ V06 بحالتين قبل/بعد EXPRESS-SHIPPING) — أقل من 20 KB |
| `backend/db/migrations/0021a_p1_payments.sql` | 96 KB | 1740 | 0021-A P1 الدفعات ورسوم التأكيد: الأعمدة · الجداول الخمسة (ومنها أوامر الدفع) · الحراس · الكتالوج · دوال zell_payment_* · دالة الانتقال · zell_create_order |
| `backend/db/migrations/0021a_p2_checkout_fee_ptest.sql` | 6 KB | 135 | 0021-A P2 اختبار قبل التطبيق (4 حالات، والنتيجة صفوف) — أقل من 20 KB |
| `backend/db/migrations/0021a_p2_checkout_fee_rollback.sql` | 1 KB | 32 | 0021-A P2 الرجوع (بيشيل الدالة بس، قبل أي رجوع لـ P1) — أقل من 20 KB |
| `backend/db/migrations/0021a_p2_checkout_fee_verify.sql` | 2 KB | 37 | 0021-A P2 التحقق بعد التطبيق — أقل من 20 KB |
| `backend/db/migrations/0021a_p2_checkout_fee.sql` | 4 KB | 75 | 0021-A P2 دالة `zell_checkout_confirmation_fee()` لـ `service_role` — أقل من 20 KB |
| `backend/db/migrations/0021d2_delivery_settings_ptest.sql` | 21 KB | 365 | 0021-D2 W1 اختبار قبل التطبيق (smoke، 6 حالات، والنتيجة صفوف) |
| `backend/db/migrations/0021d2_delivery_settings_rollback.sql` | 2 KB | 56 | 0021-D2 W1 الرجوع (الدوال والجدولين؛ بيرفض بأي سطر في السجل) — أقل من 20 KB |
| `backend/db/migrations/0021d2_delivery_settings_verify.sql` | 7 KB | 93 | 0021-D2 W1 التحقق بعد التطبيق (8 فحوص، والنتيجة صفوف) — أقل من 20 KB |
| `backend/db/migrations/0021d2_delivery_settings.sql` | 15 KB | 252 | 0021-D2 W1 إعداد موعد التسليم: الجدولين · الحراس · `zell_delivery_settings_get` / `_save` · `zell_checkout_delivery_settings` — أقل من 20 KB |
| `backend/db/migrations/0021d_preferred_delivery_ptest.sql` | 98 KB | 1938 | 0021-D اختبار قبل التطبيق (الجسم + القديمة بالحرف، والنتيجة صفوف) |
| `backend/db/migrations/0021d_preferred_delivery_rollback.sql` | 39 KB | 852 | 0021-D الرجوع (الدالتين القديمتين بالحرف من 0019) |
| `backend/db/migrations/0021d_preferred_delivery.sql` | 50 KB | 1012 | 0021-D الموعد المفضّل: الأعمدة · zell_create_order بـ 14 معامل · الإيصال · فترات Checkout |
| `backend/db/migrations/0021ex_express_shipping_ptest.sql` | 86 KB | 1514 | EXPRESS-SHIPPING W1 اختبار قبل التطبيق (الجسم منسوخ بالحرف، 8 حالات؛ على Production 7 + skip T07، والنتيجة صفوف) |
| `backend/db/migrations/0021ex_express_shipping_rollback.sql` | 42 KB | 851 | EXPRESS-SHIPPING W1 الرجوع (`zell_create_order` بـ 14 بالحرف = R1؛ بيرفض بسطر سجل أو بأي طلب بعد التطبيق، أو طول ما TRACK-ORDER v2 متطبّق) |
| `backend/db/migrations/0021ex_express_shipping_verify.sql` | 10 KB | 124 | EXPRESS-SHIPPING W1 التحقق بعد التطبيق (10 فحوص، والنتيجة صفوف) — أقل من 20 KB |
| `backend/db/migrations/0021ex_express_shipping.sql` | 68 KB | 1218 | EXPRESS-SHIPPING W1 الشحن السريع ومدة الشحن: الجدولين · الحراس · أعمدة اللقطة · `zell_shipping_options_get` / `_save` / `_checkout` · `zell_create_order` (15) |
| `backend/db/migrations/0021p_access_ptest.sql` | 123 KB | 2684 | 0021-P اختبار قبل التطبيق (الجسمين منسوخين بالحرف، والنتيجة صفوف) |
| `backend/db/migrations/0021p_access_verify.sql` | 22 KB | 343 | 0021-P التحقق بعد التطبيق (15 فحص، والنتيجة صفوف) |
| `backend/db/migrations/0021p_erp_access.sql` | 46 KB | 1048 | 0021-P المحرك `erp_*` |
| `backend/db/migrations/0021p_zell_erp_access.sql` | 42 KB | 983 | 0021-P محوّل ZELL `zell_erp_*` |
| `backend/db/migrations/0021tr2_track_order_v2_ptest.sql` | 65 KB | 960 | TRACK-ORDER v2 W1 اختبار قبل التطبيق (الجسم منسوخ بالحرف، 9 حالات؛ على Production 8 + skip T09، والنتيجة صفوف) |
| `backend/db/migrations/0021tr2_track_order_v2_rollback.sql` | 9 KB | 154 | TRACK-ORDER v2 W1 الرجوع (دالة التتبّع بجسم T1 بالحرف؛ بيرفض بأي شحنة أو رسالة أو سطر سجل) — أقل من 20 KB |
| `backend/db/migrations/0021tr2_track_order_v2_verify.sql` | 15 KB | 170 | TRACK-ORDER v2 W1 التحقق بعد التطبيق (10 فحوص، والنتيجة صفوف) — أقل من 20 KB |
| `backend/db/migrations/0021tr2_track_order_v2.sql` | 45 KB | 685 | TRACK-ORDER v2 W1 التتبّع الكامل: جدولين + سجلاتهم · الحراس · `zell_shipment_get` / `_save` · `zell_customer_update_list` / `_add` / `_edit` / `_set_hidden` · `zell_checkout_track_order` (v2) |
| `backend/db/migrations/0021tr_track_order_ptest.sql` | 15 KB | 261 | 0021-TR W1 اختبار قبل التطبيق (smoke، 6 حالات، والنتيجة صفوف) — أقل من 20 KB |
| `backend/db/migrations/0021tr_track_order_rollback.sql` | 2 KB | 45 | 0021-TR W1 الرجوع (الدالة والـ policy وصلاحيات الأعمدة على `order_items`؛ بيرفض طول ما TRACK-ORDER v2 متطبّق) — أقل من 20 KB |
| `backend/db/migrations/0021tr_track_order_verify.sql` | 18 KB | 230 | 0021-TR W1 التحقق بعد التطبيق (7 فحوص، النداءات بدور `service_role`، بحالتين قبل/بعد TRACK-ORDER v2، والنتيجة صفوف) — أقل من 20 KB |
| `backend/db/migrations/0021tr_track_order.sql` | 11 KB | 168 | 0021-TR W1 «تتبّع طلبك»: قراية `order_items` لـ `zell_order_definer` (٨ أعمدة + policy) · `zell_checkout_track_order` لـ `service_role` — أقل من 20 KB |
| `docs/contracts/0021-A.md` | 94 KB | 438 | عقد 0021-أ: دورة الطلب والتأكيد والسجل والدفعات ورسوم التأكيد · التقسيم والمخاطر |
| `docs/contracts/0021-P-code.md` | 29 KB | 249 | عقد كود 0021-P: أ ← ب1 ← ب2 · الأوضاع · الفاحص · التعديلات بعد الاعتماد |
| `docs/contracts/0021-P.md` | 22 KB | 252 | عقد 0021-P (الداتابيز): المحرك والمحوّل والهوية من الجلسة |
| `docs/contracts/EXPRESS-SHIPPING.md` | 37 KB | 194 | عقد الشحن السريع ومدة الشحن: الإعداد `zell_shipping_options` · `zell_create_order` (15) واللقطة · Checkout والـ canonical · فحوص التحقق المتأثرة · قراءات R1–R6 ونتايجها · تفاصيل W1 و W2 |
| `docs/contracts/TRACK-ORDER-v2.md` | 32 KB | 203 | عقد التتبّع الكامل: حقول v1 + v2 · المبالغ (المدفوع · المردود · الصافي · المتبقي) · خط المراحل · الشحنة · رسايل العميل · الموعد · قراءات T1–T5 ونتايجها · W1 (الأسماء والأكواد النهائية) |
| `docs/maps/db-map.md` | 51 KB | 373 | خريطة الداتابيز: كل دور وجدول ودالة ومتعرّف في أنهي ملف |
| `docs/plans/ADMIN-LANG-LIST.md` | 62 KB | 224 | حصر نصوص اللوحة العامية مع مقترح فصحى مبسّطة لكل نص (أ · ب · ج · د)، للمالك يختار منه |
| `docs/plans/ORDER-FLOW-PLAN.md` | 119 KB | 1584 | خطة مسار الطلب |
| `README.md` | 25 KB | 325 | حالة النظام الحي: الميزات · اللوحة · الهيكل · الأمان · التوثيق |

---

## `backend/db/ci/0020s_sql_ci.sh`

اختبارات SQL لـ 0020-S في CI (ptest · تطبيق · verify · نداءات زي PostgREST · rollback) · 515 سطر

| السطر | القسم |
| ---: | --- |
| 53 | attested_pr3_rollback() { |
| 57 | record() { |
| 73 | as_user() { |
| 77 | as_service() { |
| 82 | attested_rollback() { |
| 89 | run_rows() { |
| 99 | RESIDUE_SQL=$(cat <<'SQL' |
| 123 | seq_delta() { |
| 132 | big_doc() { |
| 149 | init_cluster() { |
| 178 | reset_db() { |
| 248 | # ── S0: شكل المعاملة (begin … SELECT واحد قبل rollback، من غير commit) ── |
| 256 | # ── S1: الـ ptest فيه نفس جسم الـ migration بالحرف ── |
| 268 | # ── S2: 0020 الحقيقي بيتطبّق على الـ shim ── |
| 280 | # ── S3: verify قبل التطبيق = صفوف + FAIL، و exit 0 ── |
| 285 | # ── S3b: verify 0020 (بعد التعديل) قبل 0020-S: نفس النتيجة القديمة، من غير علامة 0020-S ── |
| 290 | # ── S4: ptest (ci) قبل التطبيق، ومفيش أثر بعده ── |
| 300 | # ── S5: ptest (production): مستندات صغيرة بس (T02 = CI بس)، بأدمن ومن غير أدمن، وعدد الـ sequences … |
| 319 | # ── S6: التطبيق ── |
| 326 | # ── S7: إعادة التطبيق بترفض، والـ ptest بيرفض بعد التطبيق ── |
| 332 | # ── S8: verify ── |
| 337 | # ── S8b: verify 0020 (بعد التعديل) بعد 0020-S: part_a=ok + علامة 0020-S ── |
| 342 | # ── S9: نداءات زي PostgREST ── |
| 357 | # ── S10: rollback 0020 بيرفض طول ما 0020-S متطبّق، برسالة صريحة ── |
| 362 | # ── S11: rollback 0020-S من غير تأكيد بيرفض ── |
| 367 | # ── S12: rollback 0020-S بيرفض لو PR-3 متطبّق (service_role مالوش EXECUTE على القديمة) ── |
| 374 | # ── S13: rollback نضيف ── |
| 384 | # ── S14: إعادة التطبيق بعد الرجوع + verify ── |
| 390 | # ── S19: 0020-S PR-3 (سحب EXECUTE من service_role على الـ 23 القديمة). الحالة هنا: PR-1 متطبّق (S14… |
| 445 | # ── S15: الترتيب: rollback 0020-S ثم rollback 0020 بيشتغل ── |
| 452 | # ── S16: statement_timeout: مستند 100 سطر بجلسة authenticated تحت القيمة المعتمدة، وإثبات إن الحد ش… |
| 466 | # ── S17: ملفي 0020 بعد التعديل = النسخة القديمة بالحرف لما 0020-S مش متطبّق ── |
| 503 | # ── S18: 0020-S ناقص (دالة واحدة اتمسحت): verify 0020 بيفشل، و rollback 0020 بيطلب rollback 0020-S … |

## `backend/db/ci/0021a_sql_ci.sh`

اختبارات SQL لـ 0021-A A1 في CI (S0–S13: ptest · تطبيق · البوابة قبل/بعد · rollback · اتصالين) · 537 سطر

| السطر | القسم |
| ---: | --- |
| 88 | init_cluster() { |
| 119 | reset_db() { |
| 196 | seed_legacy() { |
| 219 | IMPACT_SQL=$(cat <<'SQL' |
| 240 | # ── S0: شكل الملفات ── |
| 254 | # ── S1: ptest قبل التطبيق ── |
| 279 | # ── S2: التطبيق ── |
| 301 | # ── S3: التوافق والبوابة مقفولة ── |
| 335 | # ── S4: الهوية ── |
| 348 | # ── S5: الانتقالات (البوابة مقفولة) ── |
| 370 | # ── S6: المكالمة والمتابعة ── |
| 385 | # ── S7: التعديل والموعد والملاحظة ── |
| 410 | # ── S8: الفترات ── |
| 422 | # ── S9: append-only والمسح ── |
| 435 | # ── S10: البوابة ── |
| 472 | # ── S11: rollback مرفوض ── |
| 495 | # ── S12: rollback نضيف + إعادة تطبيق ── |
| 512 | # ── S13: التعارض باتصالين ── |

## `backend/db/ci/0021d2_flows.sql`

0021-D2 W1 سيناريوهات الإعداد بعد التطبيق في CI (F01–F32، 24 حالة، معاملة بترجع) — أقل من 20 KB · 248 سطر

| السطر | القسم |
| ---: | --- |
| 8 | begin; |
| 14 | create function pg_temp.zt(p_name text, p_ok boolean, p_detail text) |
| 21 | create function pg_temp.call_as(p_role text, p_sub text, p_sql text) |
| 44 | create function pg_temp.save_sql(p_ts timestamptz, p_choice text, p_note text, p_text text) |
| 50 | create function pg_temp.js(p text) returns jsonb language sql as $f$ |
| 55 | do $zA$ |
| 107 | do $zB$ |
| 143 | do $zC$ |
| 201 | do $zD$ |
| 248 | rollback; |

## `backend/db/ci/0021d2_sql_ci.sh`

اختبارات SQL لـ 0021-D2 W1 في CI فوق شكل Production (S0–S5: الشكل · ptest · تطبيق · verify · السيناريوهات · rollback · حراس الـ preflight) — أقل من 20 KB · 212 سطر

| السطر | القسم |
| ---: | --- |
| 53 | record() { |
| 96 | prep() { |
| 106 | # ── S0: الشكل والملفات ── |
| 123 | # ── S1: ptest قبل التطبيق ── |
| 136 | # ── S2: التطبيق ── |
| 157 | # ── S3: السيناريوهات (معاملة بترجع) ثم حفظ حقيقي ── |
| 178 | # ── S4: الرجوع ── |
| 199 | # ── S5: حراس الـ preflight ── |

## `backend/db/ci/0021d_sql_ci.sh`

اختبارات SQL لـ 0021-D في CI (ptest · تطبيق · مقارنة قديم/جديد 480 حالة · الإيصال · rollback · الانحراف) · 391 سطر

| السطر | القسم |
| ---: | --- |
| 58 | init_cluster() { |
| 77 | reset_db() { |
| 187 | load_old_copy() { |
| 202 | IMPACT_SQL=$(cat <<'SQL' |
| 219 | PARITY_SQL=$(cat <<'SQL' |
| 293 | # ── S0: الشكل ── |
| 302 | # ── S1: ptest قبل التطبيق ── |
| 314 | # ── S2: التطبيق ── |
| 339 | # ── S3: المقارنة ── |
| 344 | # ── S4: نداء PostgREST بدور service_role + الإيصال + الفترات ── |
| 358 | # ── S5: rollback ببيانات ثم من غير ── |
| 379 | # ── S6: حارس الانحراف ── |

## `backend/db/ci/0021ex_flows.sql`

EXPRESS-SHIPPING W1 سيناريوهات الإعداد والطلب بعد التطبيق في CI (F01–F42، 38 حالة، معاملة بترجع) · 439 سطر

| السطر | القسم |
| ---: | --- |
| 10 | begin; |
| 16 | create function pg_temp.zt(p_name text, p_ok boolean, p_detail text) |
| 23 | create function pg_temp.call_as(p_role text, p_sub text, p_sql text) |
| 47 | create function pg_temp.ver() returns timestamptz language sql as $f$ |
| 52 | create function pg_temp.save_as(p_sub text, p_ts timestamptz, p_on boolean, p_govs jsonb) |
| 58 | create function pg_temp.js(p text) returns jsonb language sql as $f$ |
| 63 | create function pg_temp.co(p_key text, p_phone text, p_over jsonb, p_method text) |
| 104 | create function pg_temp.snap(p_res text) returns text language sql as $f$ |
| 110 | create function pg_temp.keys(p_res text) returns text language sql as $f$ |
| 115 | do $zA$ |
| 165 | do $zB$ |
| 255 | do $zC$ |
| 293 | do $zD$ |
| 319 | do $zE$ |
| 439 | rollback; |

## `backend/db/ci/0021ex_sql_ci.sh`

اختبارات SQL لـ EXPRESS-SHIPPING W1 في CI فوق شكل Production (S0–S6: الشكل والأكواد والفرق عن P1 · ptest · تطبيق · الأثر · verify بالحالتين · مقارنة 520 حالة × 4 نداءات · السيناريوهات · قيد اللقطة · rollback ببصمات R1 · حراس الـ preflight · S46 شحن العرض من packages/core = الداتابيز) · 506 سطر

| السطر | القسم |
| ---: | --- |
| 66 | record() { |
| 125 | prep() { |
| 137 | load_old_copy() { |
| 145 | PARITY_SQL=$(cat <<'SQL' |
| 272 | # ── S0: الشكل والملفات ── |
| 298 | # ── S1: قبل التطبيق (شكل Production) و ptest ── |
| 322 | # ── S2: التطبيق ── |
| 349 | # ── S3: فحوص التحقق بالحالتين: مفيش بصمة مجهولة ولا overload ولا خليط ── |
| 368 | # ── S4: السلوك ── |
| 427 | # ── S46: شحن العرض في المتجر (packages/core) = الداتابيز (EXPRESS-SHIPPING W2) ── |
| 436 | # ── S5: الرجوع ── |
| 477 | # ── S6: حراس الـ preflight ── |
## `backend/db/ci/0021p_sql_ci.sh`

اختبارات SQL لـ 0021-P في CI (S0–S8 و C1–C4) · 445 سطر

| السطر | القسم |
| ---: | --- |
| 37 | دالة record |
| 47 | دالة su_sql |
| 48 | دالة q |
| 49 | دالة run_pg |
| 50 | دالة run_file |
| 51 | دالة sqlstate |
| 52 | دالة has |
| 54 | دالة as_user |
| 59 | دالة init_cluster |
| 87 | دالة reset_db |
| 116 | دالة apply_engine |
| 119 | دالة adapter_run_text |
| 120 | دالة apply_adapter |
| 124 | دالة apply_all |
| 133 | دالة consistent |
| 134 | دالة owners |
| 154 | دالة residue |
| 155 | دالة rf |
| 159 | دالة pair |
| 181 | دالة in_list |
| 194 | ── S0: شكل المعاملة في الـ ptest على مستوى الجمل (begin … SELECT واحد … rollback) ── |
| 206 | ── S1: الـ ptest فيه نفس جسمين الـ migration بالحرف ── |
| 225 | دالة run_ptest |
| 232 | دالة sf |
| 233 | دالة ptest_tail |
| 237 | ── S2: ptest (ci) قبل التطبيق، ومفيش حاجة بتفضل بعده ── |
| 248 | ── S2n: الحكم لازم يقع (FAIL) والملف يكمّل ويرجّع صفوف، من غير exception طويل ── |
| 268 | ── S3: ptest (production) بمالك واحد وأدمن واحد (زي Production النهارده) ── |
| 274 | ── S3b: ptest (production) بمالك واحد بس: كمان ADMIN_GROUP و T05b بيتعدّوا ── |
| 280 | ── S4: verify قبل التطبيق (لازم يقع بصفوف) ← التطبيق ← verify ← استعلام الأثر ← verify سلبي ── |
| 304 | ── S5: إعادة التطبيق مرفوضة ── |
| 310 | ── S6: المحوّل من غير موافقة / من غير محرك ── |
| 334 | ── S7: rollback ── |
| 375 | ── S8: الحد العام على اتصالات حقيقية: الممثل المزوّر مايعدّيش ── |
| 389 | ── S9: التزامن باتصالين على الـ migration الحقيقي ── |

## `backend/db/ci/0021p1_flows.sql`

0021-A P1 سيناريوهات الدفع بعد التطبيق في CI (F01–F42، معاملة بترجع) · 538 سطر

| السطر | القسم |
| ---: | --- |
| 10 | begin; |
| 13 | do $zguard$ |
| 25 | create function pg_temp.zt(p_name text, p_ok boolean, p_detail text) |
| 31 | create function pg_temp.zt_block_fail(p_block text, p_state text, p_message text) |
| 38 | create function pg_temp.as_user(p_claims text, p_sql text, p_db_role text default 'authenticated') |
| 58 | create function pg_temp.try_exec(p_sql text, p_db_role text default 'postgres') |
| 72 | create function pg_temp.owner_c() returns text language sql as $f$ |
| 75 | create function pg_temp.admin_c() returns text language sql as $f$ |
| 78 | create function pg_temp.ver(p_order integer) returns text language sql as $f$ |
| 81 | create function pg_temp.sver() returns text language sql as $f$ |
| 84 | create function pg_temp.mid(p_name text) returns integer language sql as $f$ |
| 87 | create function pg_temp.mver(p_id integer) returns text language sql as $f$ |
| 90 | create function pg_temp.cmd(p_n integer) returns text language sql as $f$ |
| 93 | create function pg_temp.cid(p_n integer) returns uuid language sql as $f$ |
| 97 | create function pg_temp.redeliver(p_who text, p_cmd integer, p_order integer, p_amount integer, p_me… |
| 106 | create function pg_temp.repay(p_cmd integer, p_order integer, p_amount integer, p_purpose text, p_me… |
| 113 | create function pg_temp.mk(p_total integer, p_fee integer) returns integer language plpgsql as $f$ |
| 127 | create function pg_temp.pay(p_who text, p_fn text, p_cmd integer, p_order integer, p_amount integer,… |
| 134 | create function pg_temp.tr(p_who text, p_order integer, p_to text) returns jsonb language sql as $f$ |
| 138 | create function pg_temp.deliver(p_cmd integer, p_order integer, p_amount integer, p_method text, p_c… |
| 146 | create function pg_temp.paid(p_order integer) returns integer language sql as $f$ |
| 149 | create function pg_temp.st(p_order integer) returns text language sql as $f$ |
| 153 | -- ── F1: تسجيل الدفعات والرد و idempotency ── |
| 154 | do $zF1$ |
| 213 | -- ── F2: المقدم قبل التأكيد (قرار ٢) والتسليم بالباقي (قرار ٤) — البوابة مقفولة ── |
| 214 | do $zF2$ |
| 263 | -- ── F3: الآجل الصريح، والطلب الملغي، والحراس ── |
| 264 | do $zF3$ |
| 307 | -- ── F6: أوامر الدفع ولقطة النتيجة (مراجعة #122، Blocking 2). البوابة لسه مقفولة، والآجل متفعّل ── |
| 308 | do $zF6$ |
| 412 | -- ── F4: طرق الدفع والملخص و zell_create_order والتجهيز (البوابة مفتوحة) ── |
| 413 | do $zF4$ |
| 479 | -- ── F5: البصمة بعد التطبيع (مراجعة 7abbbd4، Blocking 1): نفس المعنى بمسافات أو بنص فاضي = replay (… |
| 480 | do $zF5$ |
| 538 | rollback; |

## `backend/db/ci/0021p1_sql_ci.sh`

اختبارات SQL لـ 0021-A P1 و P2 وتنضيف التجارب في CI، بتتشغّل مرتين (مالك zell_create_order = zell_order_writer ثم postgres): ptest · تطبيق · verify · مقارنة 520 حالة · الرسوم DB = core · السيناريوهات · rollback · الانحراف · التنضيف C00–C12 · ptest من غير أدمن ولا طلبات · 748 سطر

| السطر | القسم |
| ---: | --- |
| 61 | record() { |
| 95 | init_cluster() { |
| 114 | reset_db() { |
| 232 | load_old_copy() { |
| 239 | IMPACT_SQL=$(cat <<'SQL' |
| 263 | PARITY_SQL=$(cat <<'SQL' |
| 359 | # ── S0: الشكل ── |
| 369 | # ── S1: ptest قبل التطبيق ── |
| 386 | # ── S2: التطبيق ── |
| 422 | # ── S3: مقارنة zell_create_order قديم (D) / جديد (P1) ── |
| 427 | # ── S4: حساب الرسوم DB = core ── |
| 438 | # ── S5: سيناريوهات الدفع ── |
| 446 | # ── S6: rollback بفلوس مسجّلة = رفض ── |
| 469 | # ── S6ب: rollback بأمر تسليم آجل من غير أي دفعة = رفض (مراجعة #122) ── |
| 510 | # ── S6ج: rollback بسطر في سجل الإعدادات بس (من غير فلوس ولا أوامر) = رفض (مراجعة #122 B3) ── |
| 538 | # ── S7: rollback نضيف ثم إعادة التطبيق ── |
| 556 | # ── S95–S99: P2 (0021a_p2_checkout_fee.sql) فوق P1 — ptest · تطبيق · verify · النداء · rollback ── |
| 590 | # ── S8: rollback 0021-P بعد P1 (سطور المنح مصدرها migration، فمش «استخدام حقيقي»)، وبعده P1 rollbac… |
| 599 | # ── S9: حارس الانحراف ── |
| 607 | # ── C: تنضيف التجارب قبل الإطلاق (docs/contracts/CLEAN-prelaunch.md) — قبل P1 بس، وبعد P1 بيترفض ── |
| 623 | c_seed() { |
| 630 | c_concurrent() { |
| 739 | # ── S14: ptest production من غير أدمن شغال ولا أي طلب (B2): الـ skips محسوبة من البيانات والحكم بال… |

## `backend/db/ci/0021tr2_flows.sql`

TRACK-ORDER v2 W1 سيناريوهات الشحنة ورسايل العميل ورد التتبّع بعد التطبيق في CI (F00–F48، 34 حالة، معاملة بترجع) · 605 سطر

| السطر | القسم |
| ---: | --- |
| 12 | begin; |
| 19 | create function pg_temp.zt(p_name text, p_ok boolean, p_detail text) |
| 26 | create function pg_temp.call_as(p_role text, p_sub text, p_sql text) |
| 49 | create function pg_temp.owner_id() returns text language sql as $f$ select '00000000-0000-0000-0000-… |
| 50 | create function pg_temp.admin_id() returns text language sql as $f$ select '00000000-0000-0000-0000-… |
| 51 | create function pg_temp.off_id() returns text language sql as $f$ select '00000000-0000-0000-0000-00… |
| 52 | create function pg_temp.adm(p_sql text) returns text language sql as $f$ select pg_temp.call_as('aut… |
| 53 | create function pg_temp.own(p_sql text) returns text language sql as $f$ select pg_temp.call_as('aut… |
| 54 | create function pg_temp.who(p_who text, p_sql text) returns text language sql as $f$ |
| 61 | create function pg_temp.js(p text) returns jsonb language sql as $f$ |
| 66 | create function pg_temp.must(p text) returns text language plpgsql as $f$ |
| 75 | create function pg_temp.num(p_tag text) returns text language sql as $f$ select o.num from pg_temp.z… |
| 76 | create function pg_temp.oid_of(p_tag text) returns integer language sql as $f$ |
| 79 | create function pg_temp.ver(p_tag text) returns text language sql as $f$ |
| 82 | create function pg_temp.sver(p_tag text) returns text language sql as $f$ |
| 86 | create function pg_temp.uver(p_id bigint) returns text language sql as $f$ |
| 90 | create function pg_temp.today() returns date language sql as $f$ select (pg_catalog.now() at time zo… |
| 93 | create function pg_temp.co(p_key text, p_phone text, p_over jsonb, p_method text) |
| 126 | create function pg_temp.tr(p_tag text, p_to text, p_reason text) returns text language sql as $f$ |
| 130 | create function pg_temp.pay(p_who text, p_fn text, p_cmd integer, p_tag text, p_amount integer, p_re… |
| 137 | create function pg_temp.ship(p_who text, p_tag text, p_ver text, p_carrier text, p_number text, p_ur… |
| 144 | create function pg_temp.uadd(p_who text, p_tag text, p_text text) returns text language sql as $f$ |
| 148 | create function pg_temp.uedit(p_who text, p_tag text, p_id bigint, p_ver text, p_text text) returns … |
| 152 | create function pg_temp.uhide(p_who text, p_tag text, p_id bigint, p_ver text, p_hidden boolean) ret… |
| 156 | create function pg_temp.track(p_tag text) returns jsonb language sql as $f$ |
| 160 | create function pg_temp.slog(p_tag text) returns bigint language sql as $f$ |
| 163 | create function pg_temp.ulog() returns bigint language sql as $f$ select count(*) from public.zell_o… |
| 164 | create function pg_temp.statuses(p_r jsonb) returns text language sql as $f$ |
| 170 | create function pg_temp.track_v1(p_order_number text) |
| 209 | do $zS$ |
| 265 | do $zA$ |
| 308 | do $zB$ |
| 408 | do $zC$ |
| 499 | do $zD$ |
| 605 | rollback; |

## `backend/db/ci/0021tr2_sql_ci.sh`

اختبارات SQL لـ TRACK-ORDER v2 W1 في CI فوق شكل Production (S0–S7: الشكل والأكواد والأجسام · ptest · تطبيق · الأثر · verify بالحالتين · السيناريوهات · بيانات حقيقية ورفض الرجوع · التزامن بجلستين · rollback ببصمات T1 · حراس الـ preflight · توافق حارس v1) · 529 سطر

| السطر | القسم |
| ---: | --- |
| 76 | record() { |
| 148 | prep() { |
| 162 | SEED_SQL=$(cat <<'SQL' |
| 242 | SEED2_SQL=$(cat <<'SQL' |
| 283 | # ── S0: الشكل والملفات ── |
| 306 | # ── S1: قبل التطبيق (شكل Production) و ptest ── |
| 336 | # ── S2: التطبيق ── |
| 362 | # ── S3: فحوص التحقق: مفيش بصمة مجهولة ولا خليط ── |
| 374 | # ── S4: السلوك ── |
| 447 | # ── S5: الرجوع ── |
| 475 | # ── S6: حراس الـ preflight ── |
| 506 | # ── S7: توافق حارس v1 المنشور مع رد v2 (طلبات حقيقية) ── |

## `backend/db/ci/0021tr_sql_ci.sh`

اختبارات SQL لـ 0021-TR W1 في CI فوق شكل Production (S0–S5: الشكل · ptest · تطبيق · verify · الرد بالسبع حالات والموعد والسطور ومن غير بيانات عميل · null للشكل الغلط · الصلاحيات · rollback · حراس الـ preflight) · 313 سطر

| السطر | القسم |
| ---: | --- |
| 53 | record() { |
| 99 | prep() { |
| 111 | seed() { |
| 162 | # ── S0: الشكل والملفات ── |
| 176 | # ── S1: ptest قبل التطبيق ── |
| 190 | # ── S2: التطبيق ── |
| 211 | # ── S3: الرد (بدور service_role زي المتجر) ── |
| 286 | # ── S4: الرجوع ── |
| 300 | # ── S5: حراس الـ preflight ── |

## `backend/db/migrations/0006b_order_functions.sql`

دور `zell_order_writer` وأول نسخة من `zell_create_order` و`zell_get_order_receipt` · 765 سطر

| السطر | القسم |
| ---: | --- |
| 1 | 0006b — دور الكتابة ودالتي مسار الطلب |
| 80 | BEGIN |
| 83 | (1) الدور — صفر صلاحيات على الجداول |
| 85 | DO $role$ — --------------------------------------------------------------------- |
| 101 | (2) zell_create_order |
| 103 | دالة zell_create_order |
| 506 | (3) zell_get_order_receipt — إسقاط مقنّع، والتقنيع في الداتابيز |
| 508 | دالة zell_get_order_receipt |
| 580 | (3.5) الأدوار المطلوبة لازم تكون موجودة — فشل واضح جوه المعاملة (ب١٤) |
| 585 | DO $roles_exist$ — --------------------------------------------------------------------- |
| 600 | (4) الصلاحيات — PUBLIC أولاً (بيتمنح تلقائياً من المحرّك) |
| 621 | (5) تحقق ذاتي |
| 623 | DO $verify$ — --------------------------------------------------------------------- |
| 735 | COMMIT |
| 737 | أكواد الأخطاء الثابتة (الباك إند بيحوّلها لرسايل عربية ثابتة) |
| 739 | 45001 ZELL_IDEMPOTENCY_REQUIRED 45003 ZELL_IDEMPOTENCY_MISMATCH |
| 755 | التراجع (للمرجع — مش بيتنفّذ تلقائياً) |
| 757 | begin; |

## `backend/db/migrations/0006c_order_receipt_expiry.sql`

`zell_create_order` بترجّع `receipt_expires_at` · 504 سطر

| السطر | القسم |
| ---: | --- |
| 1 | 0006c — receipt_expires_at في إسقاط zell_create_order |
| 43 | BEGIN |
| 46 | (1) شرط مسبق — 0006a و 0006b لازم يكونوا منفّذين |
| 48 | DO $prereq$ — --------------------------------------------------------------------- |
| 71 | (2) zell_create_order — نفس الجسم + receipt_expires_at في الإسقاط |
| 73 | دالة zell_create_order |
| 431 | (3) تحقق ذاتي — create or replace ما يكونش ضيّع أي خصيصة |
| 433 | DO $verify$ — --------------------------------------------------------------------- |
| 496 | COMMIT |
| 498 | التراجع |
| 500 | أعد تنفيذ قسم zell_create_order من 0006b كما هو — بيرجّع الإسقاط القديم |

## `backend/db/migrations/0015_product_widths.sql`

عروض الرول (`product_widths`) + `zell_create_order` · 463 سطر

| السطر | القسم |
| ---: | --- |
| 10 | جدول product_widths |
| 33 | دالة zell_set_product_widths |
| 100 | دالة zell_create_order |

## `backend/db/migrations/0016_piece_products_rollback.sql`

الرجوع من 0016 · 451 سطر

| السطر | القسم |
| ---: | --- |
| 4 | دالة zell_create_order |
| 369 | دالة zell_get_order_receipt |

## `backend/db/migrations/0016_piece_products.sql`

منتجات القطعة والإضافات + `zell_create_order` والإيصال · 575 سطر

| السطر | القسم |
| ---: | --- |
| 13 | DO $$ |
| 22 | جدول product_addons |
| 36 | دالة zell_set_product_addons |
| 85 | DO $$ |
| 94 | دالة zell_create_order |
| 506 | دالة zell_get_order_receipt |

## `backend/db/migrations/0018_installation_fee_ptest.sql`

اختبار 0018: dry-run للـ migration مرتين + الرجوع، و61 حالة على 5 مجموعات · 10206 سطر

| السطر | القسم |
| ---: | --- |
| 8 | (1) dry-run: الـmigration ×2 + اختبارين للرجوع (RB_DUP: المنطقة مابتتكررش · RB_BLOCK: بيقف مع أوردر… |
| 11 | (2) 61 حالة على 5 مجموعات — بنية 0018 + _ptest + إعداد اختبار، وكل حالة في كتلة فرعية بترجع. |
| 75 | DO $zdry$ |
| 3647 | DO $ztest$ |
| 4973 | DO $ztest$ |
| 6299 | DO $ztest$ |
| 7625 | DO $ztest$ |
| 8917 | DO $ztest$ |

## `backend/db/migrations/0018_installation_fee_rollback.sql`

الرجوع من 0018 · 557 سطر

| السطر | القسم |
| ---: | --- |
| 16 | BEGIN |
| 20 | DO $g$ |
| 26 | DO $r$ |
| 44 | دالة zell_create_order |
| 460 | دالة zell_get_order_receipt |
| 544 | DO $c$ |
| 557 | COMMIT |

## `backend/db/migrations/0018_installation_fee.sql`

فني التركيب والمنطقة + `zell_create_order` (١٢ معامل) والإيصال · 738 سطر

| السطر | القسم |
| ---: | --- |
| 24 | BEGIN |
| 28 | DO $g$ |
| 34 | DO $p$ |
| 81 | دالة zell_create_order |
| 629 | دالة zell_get_order_receipt |
| 714 | DO $c$ |
| 738 | COMMIT |

## `backend/db/migrations/0019_coupons_ptest.sql`

اختبار 0019 · 7518 سطر

| السطر | القسم |
| ---: | --- |
| 10 | (1) DRY-RUN — الـmigration ×2 + الرجوع ×2 + RB_BLOCK + الصلاحيات. |
| 11 | (2a) PARITY_A — من غير كود: الجديدة = القديمة (أرقام + بصمة صف الأوردر والأصناف) + أخطاء الرفض. |
| 12 | (2b) PARITY_B — الشحن المجاني · overflow · replay · الإيصال · أشكال النداء (10 معامل · named 12). |
| 13 | (3) COUPONS — نسبة/ثابت/سقف/حد أدنى/تواريخ نصف مفتوحة/تفعيل/شكل الكود/تقريب/شحن مجاني/فني/خصم صفر/ا… |
| 14 | (4a) USAGE_A — max_uses · لكل موبايل · الإلغاء بيحرر · الإلغاء نهائي في الداتابيز · replay · نفس ال… |
| 15 | (4b) USAGE_B — المعاينة (مابتكتبش) · قيود الجدول · الصلاحيات والفهارس وترتيب الأقفال. |
| 17 | (1) DRY-RUN: migration ×2 + rollback ×2 + RB_BLOCK. مفيش نداء لأي zell_create_order. |
| 20 | DO $zdry$ — new=3e9de266… · receipt=711a5447… · old=∅ بعد الـmigration و 635e6613… بعد الرجوع. |
| 23 | (0) preflight: التعريفات الحالية بالظبط، ومفيش 0019 قبل كده — DO $zpre$ |
| 41 | (1) جدول الكوبونات |
| 83 | (2) لقطة الخصم في الأوردر (كله إضافي، والأوردرات الحالية discount = 0) |
| 123 | (3) الإلغاء نهائي في v1 — في الداتابيز لأي مسار (اللوحة · SQL · REST) |
| 143 | (4) مفتاح التشغيل — مقفول لحد ما المالك يفتحه من اللوحة. الدالة بتعتبر غيابه مقفول. |
| 148 | (5) دالة الأوردر: 12 → 13 معامل. drop + create جوه نفس المعاملة (مفيش لحظة من غير دالة، |
| 824 | (6) الإيصال: نفس التوقيع + discount_piastres و coupon_code |
| 917 | (7) معاينة الكود (تقديرية) |
| 986 | (8) PostgREST يقرا التوقيع الجديد (بيتبعت بعد الـcommit بس) |
| 991 | (0) preflight: قفل الأوردرات عشان مفيش أوردر بكوبون يدخل بين الفحص والرجوع، |
| 994 | DO $zrbpre$ |
| 1006 | (1) سلوك الحالات القديم: الإلغاء يرجع يتعدّل زي قبل 0019 |
| 1010 | (2) الدوال: المعاينة تتشال، والأوردر والإيصال يرجعوا بتعريفهم القديم بالحرف |
| 1643 | (3) القيود والفهارس والأعمدة |
| 1658 | (4) الجدول والمفتاح |
| 1851 | (2a) PARITY: من غير كود الجديدة = نسخة القديمة (الأرقام + بصمة صف الأوردر والأصناف). المتوقع كله SA… — DO $zpa$ |
| 1855 | (0) preflight: التعريفات الحالية بالظبط، ومفيش 0019 قبل كده — DO $zpre$ |
| 1873 | (1) جدول الكوبونات |
| 1915 | (2) لقطة الخصم في الأوردر (كله إضافي، والأوردرات الحالية discount = 0) |
| 1955 | (3) الإلغاء نهائي في v1 — في الداتابيز لأي مسار (اللوحة · SQL · REST) |
| 1975 | (4) مفتاح التشغيل — مقفول لحد ما المالك يفتحه من اللوحة. الدالة بتعتبر غيابه مقفول. |
| 1980 | (5) دالة الأوردر: 12 → 13 معامل. drop + create جوه نفس المعاملة (مفيش لحظة من غير دالة، |
| 2656 | (6) الإيصال: نفس التوقيع + discount_piastres و coupon_code |
| 2749 | (7) معاينة الكود (تقديرية) |
| 2818 | (8) PostgREST يقرا التوقيع الجديد (بيتبعت بعد الـcommit بس) |
| 2948 | (2b) PARITY: الشحن المجاني · overflow · replay · الإيصال · أشكال النداء (10 معامل · named 12). — DO $zpb$ |
| 2952 | (0) preflight: التعريفات الحالية بالظبط، ومفيش 0019 قبل كده — DO $zpre$ |
| 2970 | (1) جدول الكوبونات |
| 3012 | (2) لقطة الخصم في الأوردر (كله إضافي، والأوردرات الحالية discount = 0) |
| 3052 | (3) الإلغاء نهائي في v1 — في الداتابيز لأي مسار (اللوحة · SQL · REST) |
| 3072 | (4) مفتاح التشغيل — مقفول لحد ما المالك يفتحه من اللوحة. الدالة بتعتبر غيابه مقفول. |
| 3077 | (5) دالة الأوردر: 12 → 13 معامل. drop + create جوه نفس المعاملة (مفيش لحظة من غير دالة، |
| 3753 | (6) الإيصال: نفس التوقيع + discount_piastres و coupon_code |
| 3846 | (7) معاينة الكود (تقديرية) |
| 3915 | (8) PostgREST يقرا التوقيع الجديد (بيتبعت بعد الـcommit بس) |
| 4064 | (3) COUPONS: قواعد الكود على نسخة الجديدة. النتيجة: sub\|ship\|disc\|inst\|travel\|total\|code أو E<sqlst… — DO $zcp$ |
| 4068 | (0) preflight: التعريفات الحالية بالظبط، ومفيش 0019 قبل كده — DO $zpre$ |
| 4086 | (1) جدول الكوبونات |
| 4128 | (2) لقطة الخصم في الأوردر (كله إضافي، والأوردرات الحالية discount = 0) |
| 4168 | (3) الإلغاء نهائي في v1 — في الداتابيز لأي مسار (اللوحة · SQL · REST) |
| 4188 | (4) مفتاح التشغيل — مقفول لحد ما المالك يفتحه من اللوحة. الدالة بتعتبر غيابه مقفول. |
| 4193 | (5) دالة الأوردر: 12 → 13 معامل. drop + create جوه نفس المعاملة (مفيش لحظة من غير دالة، |
| 4869 | (6) الإيصال: نفس التوقيع + discount_piastres و coupon_code |
| 4962 | (7) معاينة الكود (تقديرية) |
| 5031 | (8) PostgREST يقرا التوقيع الجديد (بيتبعت بعد الـcommit بس) |
| 5203 | (4a) USAGE: max_uses · لكل موبايل · الإلغاء بيحرر · الإلغاء نهائي (DB) · replay · نفس المفتاح بهاش … — DO $zua$ |
| 5207 | (0) preflight: التعريفات الحالية بالظبط، ومفيش 0019 قبل كده — DO $zpre$ |
| 5225 | (1) جدول الكوبونات |
| 5267 | (2) لقطة الخصم في الأوردر (كله إضافي، والأوردرات الحالية discount = 0) |
| 5307 | (3) الإلغاء نهائي في v1 — في الداتابيز لأي مسار (اللوحة · SQL · REST) |
| 5327 | (4) مفتاح التشغيل — مقفول لحد ما المالك يفتحه من اللوحة. الدالة بتعتبر غيابه مقفول. |
| 5332 | (5) دالة الأوردر: 12 → 13 معامل. drop + create جوه نفس المعاملة (مفيش لحظة من غير دالة، |
| 6008 | (6) الإيصال: نفس التوقيع + discount_piastres و coupon_code |
| 6101 | (7) معاينة الكود (تقديرية) |
| 6170 | (8) PostgREST يقرا التوقيع الجديد (بيتبعت بعد الـcommit بس) |
| 6348 | (4b) PREVIEW + قيود الجدول + الصلاحيات. — DO $zub$ |
| 6352 | (0) preflight: التعريفات الحالية بالظبط، ومفيش 0019 قبل كده — DO $zpre$ |
| 6370 | (1) جدول الكوبونات |
| 6412 | (2) لقطة الخصم في الأوردر (كله إضافي، والأوردرات الحالية discount = 0) |
| 6452 | (3) الإلغاء نهائي في v1 — في الداتابيز لأي مسار (اللوحة · SQL · REST) |
| 6472 | (4) مفتاح التشغيل — مقفول لحد ما المالك يفتحه من اللوحة. الدالة بتعتبر غيابه مقفول. |
| 6477 | (5) دالة الأوردر: 12 → 13 معامل. drop + create جوه نفس المعاملة (مفيش لحظة من غير دالة، |
| 7153 | (6) الإيصال: نفس التوقيع + discount_piastres و coupon_code |
| 7246 | (7) معاينة الكود (تقديرية) |
| 7315 | (8) PostgREST يقرا التوقيع الجديد (بيتبعت بعد الـcommit بس) |

## `backend/db/migrations/0019_coupons_rollback.sql`

الرجوع من 0019 · 684 سطر

| السطر | القسم |
| ---: | --- |
| 8 | BEGIN |
| 11 | (0) preflight: قفل الأوردرات عشان مفيش أوردر بكوبون يدخل بين الفحص والرجوع، |
| 14 | DO $zrbpre$ |
| 26 | (1) سلوك الحالات القديم: الإلغاء يرجع يتعدّل زي قبل 0019 |
| 30 | (2) الدوال: المعاينة تتشال، والأوردر والإيصال يرجعوا بتعريفهم القديم بالحرف |
| 33 | دالة zell_create_order |
| 578 | دالة zell_get_order_receipt |
| 663 | (3) القيود والفهارس والأعمدة |
| 678 | (4) الجدول والمفتاح |
| 684 | COMMIT |

## `backend/db/migrations/0019_coupons.sql`

أكواد الخصم: `coupons` وأعمدة الطلب و`zell_create_order` و`zell_preview_coupon` والإلغاء النهائي · 988 سطر

| السطر | القسم |
| ---: | --- |
| 19 | BEGIN |
| 22 | (0) preflight: التعريفات الحالية بالظبط، ومفيش 0019 قبل كده — DO $zpre$ |
| 40 | (1) جدول الكوبونات |
| 41 | جدول coupons |
| 82 | (2) لقطة الخصم في الأوردر (كله إضافي، والأوردرات الحالية discount = 0) |
| 122 | (3) الإلغاء نهائي في v1 — في الداتابيز لأي مسار (اللوحة · SQL · REST) |
| 123 | دالة zell_orders_cancelled_final |
| 142 | (4) مفتاح التشغيل — مقفول لحد ما المالك يفتحه من اللوحة. الدالة بتعتبر غيابه مقفول. |
| 147 | (5) دالة الأوردر: 12 → 13 معامل. drop + create جوه نفس المعاملة (مفيش لحظة من غير دالة، |
| 150 | دالة zell_create_order |
| 823 | (6) الإيصال: نفس التوقيع + discount_piastres و coupon_code |
| 824 | دالة zell_get_order_receipt |
| 916 | (7) معاينة الكود (تقديرية) |
| 917 | دالة zell_preview_coupon |
| 985 | (8) PostgREST يقرا التوقيع الجديد (بيتبعت بعد الـcommit بس) |
| 988 | COMMIT |

## `backend/db/migrations/0020_inventory_purchasing_ptest.sql`

اختبار 0020 (الجسم منسوخ بين علامات >>> و <<<) · 5439 سطر

| السطر | القسم |
| ---: | --- |
| 14 | BEGIN |
| 17 | DO $zguard$ |
| 46 | بداية الجسم المنسوخ: 0020 BODY |
| 4088 | نهاية الجسم المنسوخ: 0020 BODY |
| 4262 | DO $pt_setup$ — ═══ الـfixtures بالخصائص (قراءة بس — مفيش أي تعديل على products / product_widths / … |
| 4320 | DO $pt_a$ — ═══ A. التثبيت، شكل الدور، وبروفات الإدارة والـrollback (قبل أي بيانات) ═══ |
| 4487 | DO $pt_b$ — ═══ B. الصلاحيات: caller DB role مقابل business actor ═══ |
| 4556 | DO $pt_c$ — ═══ C. التحقق ═══ |
| 4671 | DO $pt_d$ — ═══ D. التوزيع ═══ |
| 4781 | DO $pt_o$ — ═══ O. المصفوفات الفاضية (charges = [] ، lines = [] ، allocate_lr على '{}') ═══ |
| 4850 | DO $pt_e$ — ═══ E. دورة الحياة واللقطات ═══ |
| 4931 | DO $pt_i$ — ═══ I. الـreplay وإعادة الشبكة ═══ |
| 4993 | DO $pt_j$ — ═══ J. التزامن (محاكاة متتالية) والاعتماديات ═══ |
| 5081 | DO $pt_k$ — ═══ K. رصيد أول المدة ═══ |
| 5140 | DO $pt_f$ — ═══ F. الثبات (DML مباشر كـ postgres) ═══ |
| 5224 | DO $pt_h$ |
| 5246 | DO $pt_l$ — ═══ L. الـaudit ═══ |
| 5263 | DO $pt_m$ — ═══ M. الأداء: وجود الفهارس، قابلية الاستخدام (enable_seqscan=off)، الخطة الطبيعية (معل… |
| 5363 | DO $pt_n$ — ═══ N. الختام: الـrollback بيرفض مع وجود بيانات، والبصمة الحية ماتغيرتش ═══ |
| 5413 | DO $pt_end$ |
| 5439 | ROLLBACK |

## `backend/db/migrations/0020_inventory_purchasing_verify.sql`

التحقق بعد تطبيق 0020 · 397 سطر

| السطر | القسم |
| ---: | --- |
| 14 | begin; |
| 18 | do $zverify_a$ |
| 321 | do $zverify_b$ |
| 360 | do $zverify_end$ |
| 397 | rollback; |

## `backend/db/migrations/0020_inventory_purchasing.sql`

المخزون والمشتريات: الدور والجداول والـ 23 RPC والـ triggers · 4065 سطر

| السطر | القسم |
| ---: | --- |
| 21 | BEGIN |
| 22 | بداية الجسم المنسوخ: 0020 BODY |
| 26 | (0) preflight بنيوي (مفيش md5 كشرط — البصمات للمقارنة بس) — DO $zpre$ |
| 151 | (1) الدور: NOLOGIN + NOBYPASSRLS + NOINHERIT. عضوية postgres: ADMIN (تلقائي من CREATE ROLE) + SET، … |
| 152 | دور zell_inventory_definer |
| 154 | DO $zrole$ |
| 165 | DO $zrole2$ |
| 179 | (2) sequences أرقام المستندات والـlots (الفجوات عادية) |
| 185 | (3) الجداول (الـFKs على products بتتضاف في الآخر — §12.2) |
| 186 | جدول inventory_locations |
| 206 | جدول suppliers |
| 227 | جدول purchase_docs |
| 309 | جدول purchase_doc_lines |
| 350 | جدول purchase_doc_charges |
| 368 | جدول opening_stock_docs |
| 432 | جدول opening_stock_lines |
| 472 | جدول stock_lots |
| 536 | جدول inventory_commands |
| 554 | جدول inventory_audit_log |
| 577 | (4) seed: الموقع الافتراضي (مالوش audit — الـmigration نفسه هو السجل) |
| 581 | (5) الدوال المساعدة الداخلية (مفيش أي grant لـ service_role / anon / authenticated / PUBLIC) |
| 584 | دالة zell_inv_assert_owner |
| 602 | دالة zell_inv_lock_products |
| 623 | دالة zell_inv_read_products |
| 643 | دالة zell_inv_product_has_stock_refs |
| 655 | دالة zell_inv_width_allowed |
| 667 | دالة zell_inv_allocate_lr |
| 724 | دالة zell_inv_normalize_purchase |
| 1056 | دالة zell_inv_normalize_opening |
| 1305 | دالة zell_inv_command_check |
| 1332 | دالة zell_inv_doc_void_blockers |
| 1342 | دالة zell_inv_unknown_lot_references |
| 1362 | دالة zell_inv_void_contract_version |
| 1372 | (6) دوال الـtriggers (مالكها postgres). بتمنع الـDML المباشر، ومش حاجز ضد مالك الكائنات المتعمد. |
| 1373 | دالة zell_inv_trg_no_delete |
| 1383 | دالة zell_inv_trg_no_truncate |
| 1393 | دالة zell_inv_trg_append_only |
| 1404 | دالة zell_inv_trg_doc_guard |
| 1450 | دالة zell_inv_trg_child_insert_guard |
| 1500 | دالة zell_inv_trg_lot_update_guard |
| 1531 | دالة zell_inv_trg_master_guard |
| 1557 | دالة zell_inv_trg_products_sale_unit |
| 1572 | (7) RPCs: المواقع والموردين |
| 1573 | دالة zell_inv_create_location |
| 1631 | دالة zell_inv_update_location |
| 1693 | دالة zell_inv_create_supplier |
| 1760 | دالة zell_inv_update_supplier |
| 1843 | (8) RPCs: مستندات الشراء |
| 1844 | دالة zell_inv_create_purchase |
| 1941 | دالة zell_inv_update_purchase |
| 2054 | دالة zell_inv_post_purchase |
| 2297 | دالة zell_inv_discard_purchase |
| 2364 | دالة zell_inv_void_purchase |
| 2467 | (9) RPCs: رصيد أول المدة (أمر مستقل — من غير مورد ولا مصاريف ولا خصم ولا فلوس) |
| 2468 | دالة zell_inv_create_opening |
| 2552 | دالة zell_inv_update_opening |
| 2653 | دالة zell_inv_post_opening |
| 2837 | دالة zell_inv_discard_opening |
| 2903 | دالة zell_inv_void_opening |
| 3006 | (10) RPCs: القراءة (owner بس). keyset pagination، افتراضي 25 وأقصى 100، ومفيش SELECT *. |
| 3007 | دالة zell_inv_list_locations |
| 3042 | دالة zell_inv_list_suppliers |
| 3077 | دالة zell_inv_list_purchases |
| 3133 | دالة zell_inv_get_purchase |
| 3199 | دالة zell_inv_preview_purchase |
| 3288 | دالة zell_inv_list_openings |
| 3333 | دالة zell_inv_get_opening |
| 3386 | دالة zell_inv_preview_opening |
| 3468 | دالة zell_inv_list_lots |
| 3521 | (11) ملكية الدوال (§2.1): CREATE مؤقت → OWNER TO → SET LOCAL ROLE (revoke/grant) → RESET ROLE → سحب… |
| 3633 | (12) الجداول: RLS + policy واحدة للدور + صلاحيات صريحة (مفيش DELETE ولا TRUNCATE لأي دور غير المالك… |
| 3689 | DO $zseq$ |
| 3705 | (13) triggers على الجداول الجديدة |
| 3742 | (14) آخر حاجة (§12.2): FKs على products و trigger sale_unit — SHARE ROW EXCLUSIVE على products لحد … |
| 3756 | (15) postflight (أي فشل = المعاملة كلها بترجع) |
| 3758 | DO $zpost$ |
| 4064 | نهاية الجسم المنسوخ: 0020 BODY |
| 4065 | COMMIT |

## `backend/db/migrations/0020s_inv_session_ptest.sql`

0020-S PR-1 اختبار قبل التطبيق (الجسم منسوخ بالحرف، والنتيجة صفوف) · 1150 سطر

| السطر | القسم |
| ---: | --- |
| 16 | begin; |
| 20 | do $zguard$ |
| 44 | create function pg_temp.zt(p_name text, p_ok boolean, p_detail text) |
| 51 | create function pg_temp.zt_skip(p_name text, p_detail text) |
| 57 | create function pg_temp.zt_block_fail(p_block text, p_state text, p_message text) |
| 65 | create function pg_temp.as_user(p_claims text, p_sql text, p_db_role text default 'authenticated') |
| 83 | create function pg_temp.ok(p jsonb) |
| 88 | create function pg_temp.oc() |
| 94 | do $zfx$ |
| 118 | -- >>> 0020S BODY |
| 676 | -- <<< 0020S BODY |
| 678 | -- ── C: الـ catalog بعد الجسم ── |
| 679 | do $zC$ |
| 712 | -- ── R: الرفض لكل دالة من الـ 23 (معاملات NULL؛ فحص المالك أول حاجة في كل دالة قديمة) ── |
| 713 | do $zR$ |
| 785 | -- ── O1: المواقع — إنشاء بالجلسة · إعادة نفس الأمر بالطريق القديم · نفس الأمر بمحتوى مختلف · تعديل … |
| 786 | do $zO1$ |
| 817 | -- ── O2: الموردين — إنشاء بالطريق القديم ثم إعادة نفس الأمر بالجلسة · تعديل بالجلسة ── |
| 818 | do $zO2$ |
| 847 | -- ── O3: الشراء — معاينة (تطابق) · إنشاء · قراية (تطابق) · تعديل · ترحيل · إلغاء · ومسودة تانية تتم… |
| 848 | do $zO3$ |
| 913 | -- ── O4: أول المدة — نفس الدورة ── |
| 914 | do $zO4$ |
| 980 | -- ── O5: القوايم الخمسة — الجلسة = الطريق القديم ── |
| 981 | do $zO5$ |
| 1010 | -- ── O6: الممثل في inventory_commands و inventory_audit_log = sub الجلسة ── |
| 1011 | do $zO6$ |
| 1031 | -- ── T: statement_timeout للأدوار + زمن مستند كبير (100 سطر) بالجلسة ── |
| 1032 | do $zT$ |
| 1109 | with r as ( |
| 1150 | rollback; |

## `backend/db/migrations/0020s_inv_session.sql`

0020-S PR-1: 23 دالة `zell_inv_session_*` بهوية الجلسة · 579 سطر

| السطر | القسم |
| ---: | --- |
| 19 | begin; |
| 20 | -- >>> 0020S BODY |
| 24 | -- (0) خريطة الدوال: لكل دالة عامة قديمة، الدالة الجديدة بنفس المعاملات ناقص p_actor (أسماء مختلفة، … |
| 58 | create or replace function pg_temp.zell_0020s_old_fp() |
| 71 | -- (1) preflight |
| 72 | do $zs_pre$ |
| 121 | -- (2) الدوال: CREATE كـ zell_inventory_definer (SET LOCAL ROLE، زي 0020) ← سحب الكل ← EXECUTE لـ au… |
| 128 | create function public.zell_inv_claims_actor() |
| 158 | create function public.zell_inv_session_create_location(p_command_id uuid, p_code text, p_name text) |
| 170 | create function public.zell_inv_session_update_location(p_command_id uuid, p_location_id bigint, |
| 184 | create function public.zell_inv_session_create_supplier(p_command_id uuid, p_name text, p_phone text… |
| 196 | create function public.zell_inv_session_update_supplier(p_command_id uuid, p_supplier_id bigint, p_e… |
| 210 | create function public.zell_inv_session_create_purchase(p_command_id uuid, p_doc jsonb) |
| 222 | create function public.zell_inv_session_update_purchase(p_command_id uuid, p_doc_id bigint, p_expect… |
| 234 | create function public.zell_inv_session_post_purchase(p_command_id uuid, p_doc_id bigint, p_expected… |
| 246 | create function public.zell_inv_session_discard_purchase(p_command_id uuid, p_doc_id bigint, p_expec… |
| 258 | create function public.zell_inv_session_void_purchase(p_command_id uuid, p_doc_id bigint, p_expected… |
| 270 | create function public.zell_inv_session_create_opening(p_command_id uuid, p_doc jsonb) |
| 282 | create function public.zell_inv_session_update_opening(p_command_id uuid, p_doc_id bigint, p_expecte… |
| 294 | create function public.zell_inv_session_post_opening(p_command_id uuid, p_doc_id bigint, p_expected_… |
| 306 | create function public.zell_inv_session_discard_opening(p_command_id uuid, p_doc_id bigint, p_expect… |
| 318 | create function public.zell_inv_session_void_opening(p_command_id uuid, p_doc_id bigint, p_expected_… |
| 330 | create function public.zell_inv_session_list_locations(p_include_inactive boolean, p_limit integer, … |
| 342 | create function public.zell_inv_session_list_suppliers(p_include_inactive boolean, p_limit integer, … |
| 354 | create function public.zell_inv_session_list_purchases(p_status text, p_supplier_id bigint, p_limit … |
| 366 | create function public.zell_inv_session_get_purchase(p_doc_id bigint) |
| 378 | create function public.zell_inv_session_preview_purchase(p_doc jsonb) |
| 390 | create function public.zell_inv_session_list_openings(p_status text, p_limit integer, p_before_id bi… |
| 402 | create function public.zell_inv_session_get_opening(p_doc_id bigint) |
| 414 | create function public.zell_inv_session_preview_opening(p_doc jsonb) |
| 426 | create function public.zell_inv_session_list_lots(p_status text, p_product_id integer, p_location_id… |
| 491 | -- (3) postflight (أي فشل = المعاملة كلها بترجع) |
| 492 | do $zs_post$ |
| 578 | -- <<< 0020S BODY |
| 579 | commit; |

## `backend/db/migrations/0020s_pr3_ptest.sql`

0020-S PR-3 اختبار سحب `service_role` من `zell_inv_*` · 392 سطر

| السطر | القسم |
| ---: | --- |
| 10 | begin; |
| 14 | do $zguard$ |
| 39 | create function pg_temp.zt(p_name text, p_ok boolean, p_detail text) |
| 46 | create function pg_temp.zt_skip(p_name text, p_detail text) |
| 52 | create function pg_temp.zt_block_fail(p_block text, p_state text, p_message text) |
| 60 | create function pg_temp.as_user(p_claims text, p_sql text, p_db_role text default 'authenticated') |
| 78 | create function pg_temp.ok(p jsonb) |
| 83 | do $zfx$ |
| 103 | -- >>> 0020S3 BODY |
| 264 | -- <<< 0020S3 BODY |
| 266 | do $zP$ |
| 358 | with r as ( |
| 392 | rollback; |

## `backend/db/migrations/0021a_a1_order_cycle_ptest.sql`

0021-A A1 اختبار قبل التطبيق (الجسم منسوخ بالحرف، والنتيجة صفوف) · 1233 سطر

| السطر | القسم |
| ---: | --- |
| 13 | begin; |
| 17 | do $zguard$ |
| 104 | do $zfx$ |
| 130 | -- >>> 0021A1 BODY |
| 530 | -- ── الدوال العامة (EXECUTE لـ authenticated بس) ── |
| 999 | -- <<< 0021A1 BODY |
| 1001 | -- ── P: البنية والهوية والبوابة والفترات (من غير أي صف في orders) ── |
| 1002 | do $zP$ |
| 1118 | -- ── O: دورة طلب تجربة (ci بس — في production مفيش أي كتابة على orders) ── |
| 1119 | do $zO$ |
| 1199 | with r as ( |
| 1233 | rollback; |

## `backend/db/migrations/0021a_a1_order_cycle.sql`

0021-A A1 دورة الطلب: الحالتين ورا البوابة · الانتقالات · السجل · الفترات · 11 دالة بالجلسة · 892 سطر

| السطر | القسم |
| ---: | --- |
| 21 | begin; |
| 22 | -- >>> 0021A1 BODY |
| 26 | -- (0) preflight |
| 27 | do $a1pre$ |
| 100 | -- (1) الدور: NOLOGIN + NOBYPASSRLS + NOINHERIT. عضوية postgres: ADMIN (تلقائي) + SET، و INHERIT FALSE. |
| 101 | create role zell_order_definer nologin nobypassrls noinherit nocreaterole nocreatedb noreplication; |
| 104 | do $a1role$ |
| 119 | -- (2) orders: أعمدة جديدة (فاضية) + الحالتين الجداد في القيد. الصفوف القديمة ماتتغيّرش. |
| 136 | do $a1status$ |
| 160 | -- (3) الجداول الجديدة (مالكها postgres): RLS + policy للدور بس، وصفر صلاحيات لأي دور تاني. |
| 161 | create table public.order_status_transitions ( |
| 178 | create table public.order_events ( |
| 192 | create table public.order_delivery_periods ( |
| 205 | create table public.zell_order_gate ( |
| 214 | create table public.zell_order_config_log ( |
| 243 | -- (4) الثبات: السجلين append-only، والبوابة صف واحد ومفيش مسح. دوال الـ triggers مالكها postgres (invoker). |
| 298 | -- (5) الدوال: CREATE كـ zell_order_definer (SET LOCAL ROLE). |
| 772 | -- (6) triggers على orders. |
| 806 | -- (7) EXECUTE: الكل مسحوب، وبعدين: العامة الـ 11 لـ authenticated (منهم البوابة، للمالك بس جوه الدالة) · ح… |
| 843 | -- (8) postflight |
| 844 | do $a1post$ |
| 891 | -- <<< 0021A1 BODY |
| 892 | commit; |

## `backend/db/migrations/0021a_p1_payments_ptest.sql`

0021-A P1 اختبار قبل التطبيق (الجسم + zell_create_order الحالية بالحرف، والنتيجة صفوف؛ الـ skips من البيانات والحكم بالعدد) · 2988 سطر

| السطر | القسم |
| ---: | --- |
| 14 | begin; |
| 19 | do $zguard$ |
| 58 | create function pg_temp.zt(p_name text, p_ok boolean, p_detail text) |
| 64 | create function pg_temp.zt_skip(p_name text, p_detail text) |
| 70 | create function pg_temp.zt_block_fail(p_block text, p_state text, p_message text) |
| 78 | create function pg_temp.as_user(p_claims text, p_sql text, p_db_role text default 'authenticated') |
| 98 | create function pg_temp.try_exec(p_sql text, p_db_role text default 'postgres') |
| 112 | create function pg_temp.cl(p_user uuid) |
| 117 | create function pg_temp.settings_ver() |
| 125 | create function pg_temp.call_sql(p_fn text, p_items text, p_name text, p_phone text, p_gov text, p_a… |
| 138 | create function pg_temp.try_call(p_sql text) |
| 153 | create function pg_temp.order_text(p_number text) |
| 163 | CREATE FUNCTION pg_temp.zell_create_order_old(p_items jsonb, p_customer_name text, p_customer_phone … |
| 871 | -- >>> 0021A_P1 BODY |
| 2587 | -- <<< 0021A_P1 BODY |
| 2589 | -- ── S: البنية (كل الـ profiles) ── |
| 2590 | do $zS$ |
| 2666 | -- ── C: حساب الرسوم (كل الـ profiles) ── |
| 2667 | do $zC$ |
| 2715 | -- ── V: الإعدادات (كل الـ profiles؛ جدول P1 بس) ── |
| 2716 | do $zV$ |
| 2788 | -- ── M: طرق الدفع (كل الـ profiles؛ جدول P1 بس) ── |
| 2789 | do $zM$ |
| 2832 | -- ── G: الحراس (كل الـ profiles؛ مفيش كتابة بتنجح على جدول قديم) ── |
| 2833 | do $zG$ |
| 2863 | -- ── P: رفض zell_create_order قبل أي إدخال، والرسوم متفعّلة (كل الـ profiles) — قديم = جديد بالحرف … |
| 2864 | do $zP$ |
| 2903 | -- ── O: طلبات صالحة قديم/جديد (ci بس) — الفرق الوحيد عمود الرسوم، وقيمته = الحساب ── |
| 2904 | do $zO$ |
| 2988 | rollback; |

## `backend/db/migrations/0021a_p1_payments_rollback.sql`

0021-A P1 الرجوع (zell_create_order من D ودالة الانتقال من A1 بالحرف؛ بيرفض بفلوس أو أوامر أو سطر إعدادات أو P2 متطبّق) · 885 سطر

| السطر | القسم |
| ---: | --- |
| 13 | begin; |
| 17 | do $p1rb$ |
| 59 | -- (1) zell_create_order ← تعريف D بالحرف (CREATE OR REPLACE = نفس المالك والصلاحيات). |
| 60 | CREATE OR REPLACE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_… |
| 768 | -- (2) دالة الانتقال ← تعريف A1 بالحرف، وشيل دوال الدور (مالكها zell_order_definer، فـ SET LOCAL ROL… |
| 772 | create or replace function public.zell_order_apply_transition(p_order public.orders, p_to text, p_ac… |
| 815 | -- (3) الحراس والجداول والعمودين. |
| 829 | -- (4) كتالوج 0021-P: سحب المنح (سطر سجل لكل مستخدم مصدره migration) ← القالب ← الصلاحيتين. |
| 830 | do $p1rbcat$ |
| 855 | -- (5) postflight |
| 856 | do $p1rbpost$ |
| 885 | commit; |

## `backend/db/migrations/0021a_p1_payments_verify.sql`

0021-A P1 التحقق بعد التطبيق (النتيجة صفوف؛ V06 بحالتين قبل/بعد EXPRESS-SHIPPING) — أقل من 20 KB · 171 سطر

| السطر | القسم |
| ---: | --- |
| 11 | begin; |
| 171 | rollback; |
## `backend/db/migrations/0021a_p1_payments.sql`

0021-A P1 الدفعات ورسوم التأكيد: الأعمدة · الجداول الخمسة (ومنها أوامر الدفع) · الحراس · الكتالوج · دوال zell_payment_* · دالة الانتقال · zell_create_order · 1740 سطر

| السطر | القسم |
| ---: | --- |
| 22 | begin; |
| 23 | -- >>> 0021A_P1 BODY |
| 27 | -- (0) preflight: A1 + D + 0021-P متطبّقين، و P1 لأ، والدالتين اللي بنعدّلهم زي التعريف المحفوظ بالح… |
| 28 | do $p1pre$ |
| 95 | -- (1) orders: المدفوع الصافي ولقطة رسوم التأكيد. الصفوف القديمة = 0 و 0 (مفيش دفعات قبل كده). الإجم… |
| 105 | -- (2) الجداول الجديدة (مالكها postgres): RLS + policy للدور بس، وصفر صلاحيات لأي دور تاني. |
| 106 | create table public.zell_payment_methods ( |
| 122 | create table public.order_payments ( |
| 144 | create table public.zell_payment_settings ( |
| 163 | create table public.zell_payment_config_log ( |
| 178 | create table public.zell_payment_commands ( |
| 207 | -- (3) الحراس (دوال trigger مالكها postgres). |
| 208 | create function public.zell_payment_trg_append_only() |
| 215 | create function public.zell_payment_trg_settings_guard() |
| 223 | create function public.zell_payment_trg_orders_money() |
| 264 | -- (4) كتالوج 0021-P (ر٢): صلاحيتين جداد. تسجيل الدفعات فئة sales (في قالب «أدمن زي النهارده» وبتتمن… |
| 272 | do $p1grant$ |
| 296 | -- (5) الدوال: CREATE كـ zell_order_definer (SET LOCAL ROLE)، زي A1. الأسماء zell_payment_* (مش zell… |
| 301 | create function public.zell_payment_text(p_value text, p_max integer, p_field text) |
| 314 | create function public.zell_payment_cfg_int(p_config jsonb, p_key text, p_max bigint) |
| 325 | create function public.zell_payment_fee_calc(p_config jsonb, p_total integer, p_shipping integer, |
| 361 | create function public.zell_payment_validate_fee(p_config jsonb) |
| 430 | create function public.zell_payment_order_fee(p_total integer, p_shipping integer, p_made_to_measure… |
| 437 | create function public.zell_payment_lock(p_order_id integer) |
| 454 | create function public.zell_payment_summary(p_order_id integer, p_with_rows boolean) |
| 483 | create function public.zell_payment_apply(p_kind text, p_order public.orders, p_actor uuid, p_comman… |
| 551 | create function public.zell_payment_entry(p_kind text, p_owner_only boolean, p_command_id uuid, p_or… |
| 594 | create function public.zell_payment_settings_json() |
| 603 | create function public.zell_payment_methods_json() |
| 612 | -- (5-ب) الدوال العامة (EXECUTE لـ authenticated بس): الهوية من الجلسة (zell_order_actor من A1)، ومف… |
| 615 | create function public.zell_payment_record(p_command_id uuid, p_order_id integer, p_expected_updated… |
| 626 | create function public.zell_payment_refund(p_command_id uuid, p_order_id integer, p_expected_updated… |
| 637 | create function public.zell_payment_deliver_order(p_command_id uuid, p_order_id integer, p_expected_… |
| 702 | create function public.zell_payment_order_summary(p_order_id integer) |
| 720 | create function public.zell_payment_list_methods() |
| 729 | create function public.zell_payment_add_method(p_name text, p_sort_order integer default null) |
| 759 | create function public.zell_payment_update_method(p_id integer, p_expected_updated_at timestamptz, p… |
| 795 | create function public.zell_payment_delete_method(p_id integer, p_expected_updated_at timestamptz) |
| 825 | create function public.zell_payment_get_settings() |
| 834 | create function public.zell_payment_save_settings(p_expected_updated_at timestamptz, p_confirmation_… |
| 867 | -- (6) دالة الانتقال (A1، داخلية): نفس النص + قاعدتين (قرارات ٢ و٤). CREATE OR REPLACE = نفس المالك … |
| 868 | create or replace function public.zell_order_apply_transition(p_order public.orders, p_to text, p_ac… |
| 906 | -- (7) EXECUTE: الكل مسحوب، وبعدين: العامة الـ 10 لـ authenticated، والرسوم لمالك zell_create_order … |
| 935 | do $p1exec$ |
| 950 | -- (8) zell_create_order (§٦-١): من التعريف الحي بعد D (البصمة في الـ preflight)، والفرق الوحيد عمود… |
| 952 | CREATE OR REPLACE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_… |
| 1666 | -- (9) postflight |
| 1667 | do $p1post$ |
| 1739 | -- <<< 0021A_P1 BODY |
| 1740 | commit; |

## `backend/db/migrations/0021a_p2_checkout_fee_ptest.sql`

0021-A P2 اختبار قبل التطبيق (4 حالات، والنتيجة صفوف) — أقل من 20 KB · 135 سطر

| السطر | القسم |
| ---: | --- |
| 7 | begin; |
| 11 | do $zguard$ |
| 21 | create function pg_temp.zt(p_name text, p_ok boolean, p_detail text) |
| 27 | create function pg_temp.call_as(p_role text) returns text language plpgsql as $f$ |
| 42 | -- >>> 0021A_P2 BODY |
| 102 | -- <<< 0021A_P2 BODY |
| 104 | do $zT$ |
| 135 | rollback; |

## `backend/db/migrations/0021a_p2_checkout_fee_rollback.sql`

0021-A P2 الرجوع (بيشيل الدالة بس، قبل أي رجوع لـ P1) — أقل من 20 KB · 32 سطر

| السطر | القسم |
| ---: | --- |
| 5 | begin; |
| 9 | do $p2rb$ |
| 24 | do $p2rbpost$ |
| 32 | commit; |

## `backend/db/migrations/0021a_p2_checkout_fee_verify.sql`

0021-A P2 التحقق بعد التطبيق — أقل من 20 KB · 37 سطر

| السطر | القسم |
| ---: | --- |
| 6 | begin; |
| 37 | rollback; |

## `backend/db/migrations/0021a_p2_checkout_fee.sql`

0021-A P2 دالة `zell_checkout_confirmation_fee()` لـ `service_role` — أقل من 20 KB · 75 سطر

| السطر | القسم |
| ---: | --- |
| 13 | begin; |
| 14 | -- >>> 0021A_P2 BODY |
| 18 | -- (0) preflight: P1 متطبّق، و P2 لأ. |
| 19 | do $p2pre$ |
| 41 | -- (1) إعداد رسوم التأكيد للـ Checkout (قراية بس): مالكها zell_order_definer، EXECUTE لـ service_rol… |
| 46 | create function public.zell_checkout_confirmation_fee() |
| 58 | -- (2) postflight |
| 59 | do $p2post$ |
| 74 | -- <<< 0021A_P2 BODY |
| 75 | commit; |

## `backend/db/migrations/0021d2_delivery_settings_ptest.sql`

0021-D2 W1 اختبار قبل التطبيق (smoke، 6 حالات، والنتيجة صفوف) · 365 سطر

| السطر | القسم |
| ---: | --- |
| 8 | begin; |
| 12 | do $zguard$ |
| 30 | create function pg_temp.zt(p_name text, p_ok boolean, p_detail text) |
| 36 | create function pg_temp.call_as(p_role text, p_sql text) |
| 57 | -- >>> 0021D2 BODY |
| 61 | -- (0) preflight: الموافقة · المتطلبات (A1 · D · P1 · P2) · مش متطبّق قبل كده · الكود 45430 مش مستخدم في أي دالة. |
| 62 | do $d2pre$ |
| 96 | -- (1) الجداول (مالكها postgres): RLS + policy لـ zell_order_definer بس، وصفر صلاحيات لـ anon و authenticated و servi… |
| 98 | create table public.zell_delivery_settings ( |
| 114 | create table public.zell_delivery_settings_log ( |
| 134 | -- (2) الثبات: السجل append-only (مفيش UPDATE ولا DELETE ولا TRUNCATE)، وصف الإعداد مايتمسحش. دالة الـ trigger مالكها |
| 136 | create function public.zell_delivery_settings_trg_append_only() |
| 153 | -- (3) الدوال: CREATE كـ zell_order_definer (SET LOCAL ROLE). الأسماء برّه عدّادات zell_order_* و zell_payment_* (ر٥). |
| 158 | create function public.zell_delivery_settings_get() |
| 175 | create function public.zell_delivery_settings_save(p_expected_updated_at timestamptz, p_customer_choice_enabled boolean, |
| 227 | create function public.zell_checkout_delivery_settings() |
| 246 | -- (4) postflight |
| 247 | do $d2post$ |
| 286 | -- <<< 0021D2 BODY |
| 288 | do $zT$ |
| 365 | rollback; |

## `backend/db/migrations/0021d2_delivery_settings_rollback.sql`

0021-D2 W1 الرجوع (الدوال والجدولين؛ بيرفض بأي سطر في السجل) — أقل من 20 KB · 56 سطر

| السطر | القسم |
| ---: | --- |
| 7 | begin; |
| 11 | do $d2rb$ |
| 25 | do $d2rbdata$ |
| 43 | do $d2rbpost$ |
| 56 | commit; |

## `backend/db/migrations/0021d2_delivery_settings_verify.sql`

0021-D2 W1 التحقق بعد التطبيق (8 فحوص، والنتيجة صفوف) — أقل من 20 KB · 93 سطر

| السطر | القسم |
| ---: | --- |
| 8 | begin; |
| 93 | rollback; |

## `backend/db/migrations/0021d2_delivery_settings.sql`

0021-D2 W1 إعداد موعد التسليم: الجدولين · الحراس · `zell_delivery_settings_get` / `_save` · `zell_checkout_delivery_settings` — أقل من 20 KB · 252 سطر

| السطر | القسم |
| ---: | --- |
| 21 | begin; |
| 22 | -- >>> 0021D2 BODY |
| 26 | -- (0) preflight: الموافقة · المتطلبات (A1 · D · P1 · P2) · مش متطبّق قبل كده · الكود 45430 مش مستخدم في أي دالة. |
| 27 | do $d2pre$ |
| 61 | -- (1) الجداول (مالكها postgres): RLS + policy لـ zell_order_definer بس، وصفر صلاحيات لـ anon و authenticated و servi… |
| 63 | create table public.zell_delivery_settings ( |
| 79 | create table public.zell_delivery_settings_log ( |
| 99 | -- (2) الثبات: السجل append-only (مفيش UPDATE ولا DELETE ولا TRUNCATE)، وصف الإعداد مايتمسحش. دالة الـ trigger مالكها |
| 101 | create function public.zell_delivery_settings_trg_append_only() |
| 118 | -- (3) الدوال: CREATE كـ zell_order_definer (SET LOCAL ROLE). الأسماء برّه عدّادات zell_order_* و zell_payment_* (ر٥). |
| 123 | create function public.zell_delivery_settings_get() |
| 140 | create function public.zell_delivery_settings_save(p_expected_updated_at timestamptz, p_customer_choice_enabled boolean, |
| 192 | create function public.zell_checkout_delivery_settings() |
| 211 | -- (4) postflight |
| 212 | do $d2post$ |
| 251 | -- <<< 0021D2 BODY |
| 252 | commit; |

## `backend/db/migrations/0021d_preferred_delivery_ptest.sql`

0021-D اختبار قبل التطبيق (الجسم + القديمة بالحرف، والنتيجة صفوف) · 1938 سطر

| السطر | القسم |
| ---: | --- |
| 11 | begin; |
| 15 | do $zguard$ |
| 90 | CREATE FUNCTION pg_temp.zell_create_order_old(p_items jsonb, p_customer_name text, p_customer_phone text, p… |
| 761 | -- >>> 0021D BODY |
| 765 | -- (0) preflight: A1 متطبّق، D لأ، والدالتين زي التعريف المحفوظ في الريبو بالحرف (بصمة prosrc). |
| 766 | do $d0pre$ |
| 820 | -- (1) orders: لقطة الموعد المفضّل (فاضية للأوردرات القديمة). |
| 834 | -- (2) zell_create_order: القديم (13) بيتشال، والجديد (14) = نفس النص + المعامل والتحقق والأعمدة التلاتة. |
| 835 | drop function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, b… |
| 836 | CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_gove… |
| 1546 | do $d2own$ |
| 1579 | -- (3) الإيصال: مفتاح preferred_delivery بس (CREATE OR REPLACE = نفس المالك والصلاحيات). |
| 1580 | CREATE OR REPLACE FUNCTION public.zell_get_order_receipt(p_order_number text, p_receipt_token_hash text) |
| 1679 | -- (4) أوقات الفترات للـ Checkout (قراية بس): مالكها zell_order_definer، EXECUTE لـ service_role بس. |
| 1698 | -- (5) postflight |
| 1699 | do $d5post$ |
| 1752 | -- <<< 0021D BODY |
| 1754 | -- ── P: رفض قبل أي إدخال (كل الـ profiles) ── |
| 1755 | do $zP$ |
| 1848 | -- ── O: مقارنة طلبات صالحة قديم/جديد + الإيصال + الـ replay (ci بس) ── |
| 1849 | do $zO$ |
| 1938 | rollback; |

## `backend/db/migrations/0021d_preferred_delivery_rollback.sql`

0021-D الرجوع (الدالتين القديمتين بالحرف من 0019) · 852 سطر

| السطر | القسم |
| ---: | --- |
| 9 | begin; |
| 13 | do $drb0$ |
| 31 | drop function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, b… |
| 32 | CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_gove… |
| 703 | do $drb1$ |
| 736 | CREATE OR REPLACE FUNCTION public.zell_get_order_receipt(p_order_number text, p_receipt_token_hash text) |
| 827 | drop function public.zell_checkout_delivery_periods(); |
| 830 | do $drb2$ |
| 852 | commit; |

## `backend/db/migrations/0021d_preferred_delivery.sql`

0021-D الموعد المفضّل: الأعمدة · zell_create_order بـ 14 معامل · الإيصال · فترات Checkout · 1012 سطر

| السطر | القسم |
| ---: | --- |
| 19 | begin; |
| 20 | -- >>> 0021D BODY |
| 24 | -- (0) preflight: A1 متطبّق، D لأ، والدالتين زي التعريف المحفوظ في الريبو بالحرف (بصمة prosrc). |
| 25 | do $d0pre$ |
| 79 | -- (1) orders: لقطة الموعد المفضّل (فاضية للأوردرات القديمة). |
| 93 | -- (2) zell_create_order: القديم (13) بيتشال، والجديد (14) = نفس النص + المعامل والتحقق والأعمدة التلاتة. |
| 94 | drop function public.zell_create_order(jsonb, text, text, text, text, text, text, text, text, text, text, b… |
| 95 | CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text, p_gove… |
| 805 | do $d2own$ |
| 838 | -- (3) الإيصال: مفتاح preferred_delivery بس (CREATE OR REPLACE = نفس المالك والصلاحيات). |
| 839 | CREATE OR REPLACE FUNCTION public.zell_get_order_receipt(p_order_number text, p_receipt_token_hash text) |
| 938 | -- (4) أوقات الفترات للـ Checkout (قراية بس): مالكها zell_order_definer، EXECUTE لـ service_role بس. |
| 957 | -- (5) postflight |
| 958 | do $d5post$ |
| 1011 | -- <<< 0021D BODY |
| 1012 | commit; |

## `backend/db/migrations/0021ex_express_shipping_ptest.sql`

EXPRESS-SHIPPING W1 اختبار قبل التطبيق (الجسم منسوخ بالحرف، 8 حالات؛ على Production 7 + skip T07، والنتيجة صفوف) · 1514 سطر

| السطر | القسم |
| ---: | --- |
| 12 | begin; |
| 17 | do $zguard$ |
| 58 | create function pg_temp.zt(p_name text, p_ok boolean, p_detail text) |
| 64 | create function pg_temp.zt_skip(p_name text, p_detail text) |
| 70 | create function pg_temp.call_as(p_role text, p_sql text) |
| 93 | create function pg_temp.co_try(p_sql text) |
| 121 | create function pg_temp.co_sql(p_case text, p_over jsonb, p_method text) |
| 169 | do $zold$ |
| 180 | -- >>> 0021EX BODY |
| 184 | -- (0) preflight: المتصل · الموافقة · المتطلبات (A1 · D · P1 · P2 · D2 · TR) · مش متطبّق قبل كده · z… |
| 187 | do $expre$ |
| 248 | -- (1) الجداول (مالكها postgres): RLS + policy لـ zell_order_definer بس، وصفر صلاحيات لـ anon و auth… |
| 250 | create table public.zell_shipping_options ( |
| 261 | create table public.zell_shipping_options_log ( |
| 281 | -- (2) الثبات: السجل append-only (مفيش UPDATE ولا DELETE ولا TRUNCATE)، وصف الإعداد مايتمسحش. دالة ا… |
| 283 | create function public.zell_shipping_options_trg_append_only() |
| 300 | -- (3) orders: لقطة الطريقة والمدة (العقد §٢-٣). nullable ومن غير default، فالصفوف الموجودة ماتتكتبش… |
| 315 | -- (4) الدوال: CREATE كـ zell_order_definer (SET LOCAL ROLE). الأسماء برّه عدّادات zell_order_* و ze… |
| 321 | create function public.zell_shipping_options_get() |
| 339 | create function public.zell_shipping_options_save(p_expected_updated_at timestamptz, p_express_enabl… |
| 465 | create function public.zell_shipping_options_checkout() |
| 482 | -- (5) zell_create_order: 14 ← 15 (العقد §٢-٣). القديمة بتتشال (مفيش overload — PGRST203)، والجديدة … |
| 487 | CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text,… |
| 1259 | do $exacl$ |
| 1283 | -- (6) postflight |
| 1284 | do $expost$ |
| 1368 | -- <<< 0021EX BODY |
| 1370 | do $zT$ |
| 1514 | rollback; |

## `backend/db/migrations/0021ex_express_shipping_rollback.sql`

EXPRESS-SHIPPING W1 الرجوع (`zell_create_order` بـ 14 بالحرف = R1؛ بيرفض بسطر سجل أو بأي طلب بعد التطبيق، أو طول ما TRACK-ORDER v2 متطبّق) · 851 سطر

| السطر | القسم |
| ---: | --- |
| 13 | begin; |
| 17 | do $exrb$ |
| 51 | do $exrbdata$ |
| 75 | CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text,… |
| 789 | do $exrbacl$ |
| 819 | do $exrbpost$ |
| 851 | commit; |
## `backend/db/migrations/0021ex_express_shipping_verify.sql`

EXPRESS-SHIPPING W1 التحقق بعد التطبيق (10 فحوص، والنتيجة صفوف) — أقل من 20 KB · 124 سطر

| السطر | القسم |
| ---: | --- |
| 9 | begin; |
| 124 | rollback; |

## `backend/db/migrations/0021ex_express_shipping.sql`

EXPRESS-SHIPPING W1 الشحن السريع ومدة الشحن: الجدولين · الحراس · أعمدة اللقطة · `zell_shipping_options_get` / `_save` / `_checkout` · `zell_create_order` (15) · 1218 سطر

| السطر | القسم |
| ---: | --- |
| 28 | begin; |
| 29 | -- >>> 0021EX BODY |
| 33 | -- (0) preflight: المتصل · الموافقة · المتطلبات (A1 · D · P1 · P2 · D2 · TR) · مش متطبّق قبل كده · z… |
| 36 | do $expre$ |
| 97 | -- (1) الجداول (مالكها postgres): RLS + policy لـ zell_order_definer بس، وصفر صلاحيات لـ anon و auth… |
| 99 | create table public.zell_shipping_options ( |
| 110 | create table public.zell_shipping_options_log ( |
| 130 | -- (2) الثبات: السجل append-only (مفيش UPDATE ولا DELETE ولا TRUNCATE)، وصف الإعداد مايتمسحش. دالة ا… |
| 132 | create function public.zell_shipping_options_trg_append_only() |
| 149 | -- (3) orders: لقطة الطريقة والمدة (العقد §٢-٣). nullable ومن غير default، فالصفوف الموجودة ماتتكتبش… |
| 164 | -- (4) الدوال: CREATE كـ zell_order_definer (SET LOCAL ROLE). الأسماء برّه عدّادات zell_order_* و ze… |
| 170 | create function public.zell_shipping_options_get() |
| 188 | create function public.zell_shipping_options_save(p_expected_updated_at timestamptz, p_express_enabl… |
| 314 | create function public.zell_shipping_options_checkout() |
| 331 | -- (5) zell_create_order: 14 ← 15 (العقد §٢-٣). القديمة بتتشال (مفيش overload — PGRST203)، والجديدة … |
| 336 | CREATE FUNCTION public.zell_create_order(p_items jsonb, p_customer_name text, p_customer_phone text,… |
| 1108 | do $exacl$ |
| 1132 | -- (6) postflight |
| 1133 | do $expost$ |
| 1217 | -- <<< 0021EX BODY |
| 1218 | commit; |

## `backend/db/migrations/0021p_access_ptest.sql`

0021-P اختبار قبل التطبيق (الجسمين منسوخين بالحرف، والنتيجة صفوف) · 2684 سطر

| السطر | القسم |
| ---: | --- |
| 20 | BEGIN |
| 25 | DO $zguard$ |
| 127 | DO $zfx$ — الـ fixtures والـ skip المتوقع: من الصفوف الموجودة. ملف ci بس ممكن يضيف صفوف (جوه المعام… |
| 167 | بداية الجسم المنسوخ: 0021P ENGINE BODY |
| 1187 | نهاية الجسم المنسوخ: 0021P ENGINE BODY |
| 1190 | DO $zt01$ — T01: المحرك لوحده — كل دواله داخلية، والواجهة بترفض الكل، والإدارة مقفولة (45300) وبتتس… |
| 1215 | بداية الجسم المنسوخ: 0021P ADAPTER BODY |
| 2175 | نهاية الجسم المنسوخ: 0021P ADAPTER BODY |
| 2177 | (B) الواجهة والعدّاد وتجاوز المالك والمنح الصريح — DO $zt_b$ |
| 2222 | (C) الإدارة على أدمن بجلسة المالك (ADMIN_GROUP) — DO $zt_c$ |
| 2358 | (D) مالك تاني — DO $zt_d$ |
| 2388 | (E) تغيير النفس والمدخلات الغلط — DO $zt_e$ |
| 2412 | (F) الحد العام والممثل المزوّر — DO $zt_f$ |
| 2458 | (G) الحماية في الداتابيز (كـ postgres، وكل حاجة بترجع) — DO $zt_g$ |
| 2495 | (H) مفيش مفاتيح تكلفة في أي قراءة (بجلسة المالك) — DO $zt_h$ |
| 2521 | (I) أحداث الـ shadow (best-effort، بجلسة المالك) — DO $zt_i$ |
| 2550 | (J) المطابقة والصلاحيات — DO $zt_j$ |
| 2588 | (K) upsert من غير تغيير مابيتحسبش مرتين (ci بس: ممكن admin_users الحقيقي فيه أعمدة إجبارية تانية) — DO $zt_k$ |
| 2610 | (L) الواجهة لو رجّعت شكل غلط: الكل مرفوض (45309)، وبعدين بترجع — DO $zt_l$ |
| 2636 | (M) كل سطور الرفض بأعمدة ثابتة — DO $zt_m$ |
| 2684 | ROLLBACK |

## `backend/db/migrations/0021p_access_verify.sql`

0021-P التحقق بعد التطبيق (15 فحص، والنتيجة صفوف) · 343 سطر

| السطر | القسم |
| ---: | --- |
| 15 | begin; |
| 20 | do $zverify$ |
| 343 | rollback; |

## `backend/db/migrations/0021p_erp_access.sql`

0021-P المحرك `erp_*` · 1048 سطر

| السطر | القسم |
| ---: | --- |
| 26 | BEGIN |
| 27 | بداية الجسم المنسوخ: 0021P ENGINE BODY |
| 31 | (0) preflight — DO $epre$ |
| 61 | (1) الدور: NOLOGIN + NOBYPASSRLS + NOINHERIT. عضوية postgres: ADMIN (تلقائي من CREATE ROLE) + SET، … |
| 62 | دور erp_definer |
| 65 | DO $erole$ |
| 82 | (2) الجداول (مالكها postgres) |
| 83 | جدول erp_capabilities |
| 93 | جدول erp_presets |
| 101 | جدول erp_preset_items |
| 107 | جدول erp_user_grants |
| 117 | جدول erp_user_access |
| 124 | جدول erp_commands |
| 136 | جدول erp_access_audit |
| 166 | جدول erp_access_shadow_events |
| 214 | (3) الثبات (دالة trigger مالكها postgres). بتمنع الـDML المباشر، ومش حاجز ضد مالك الكائنات المتعمد. |
| 215 | دالة erp_trg_immutable |
| 248 | (4) الواجهة الثابتة (نسخة 1). المحرك بيعملها بجسم بيرفض الكل؛ المحوّل بيستبدل الجسم بس، ومالكها بيب… |
| 249 | دالة erp_actor_status_v1 |
| 261 | دالة erp_actor_status_contract_version |
| 271 | (5) الدوال الداخلية (مالكها erp_definer، ومفيش EXECUTE لـ service_role) |
| 273 | دالة erp_actor_status |
| 302 | دالة erp_has_capability |
| 328 | دالة erp_require_capability |
| 342 | دالة erp_access_request_hash |
| 352 | دالة erp_access_denial |
| 363 | دالة erp_access_reason |
| 384 | دالة erp_access_lock_user |
| 396 | دالة erp_access_user_keys |
| 408 | دالة erp_access_preset_keys |
| 420 | دالة erp_access_user_version |
| 430 | دالة erp_access_bump |
| 450 | دالة erp_access_command_begin |
| 482 | دالة erp_access_command_finish |
| 513 | دالة erp_access_target_check |
| 546 | (6) دوال الإدارة والقراءة (مالكها erp_definer، SECURITY DEFINER). داخلية: EXECUTE لدور المحوّل بس (… |
| 547 | دالة erp_effective_capabilities |
| 578 | دالة erp_access_grant |
| 635 | دالة erp_access_revoke |
| 690 | دالة erp_access_apply_preset |
| 753 | دالة erp_access_revoke_all |
| 803 | دالة erp_access_snapshot |
| 831 | دالة erp_access_audit_page |
| 865 | دالة erp_record_shadow_event |
| 888 | دالة erp_access_shadow_report |
| 910 | (7) صلاحيات المحرك نفسه (المالك فقط، ومش قابلة للمنح) |
| 916 | (8) ملكية الدوال: CREATE كـ postgres ← سحب الكل ← OWNER TO erp_definer ← SET LOCAL ROLE (grant) ← R… |
| 974 | (9) postflight — DO $epost$ |
| 1047 | نهاية الجسم المنسوخ: 0021P ENGINE BODY |
| 1048 | COMMIT |

## `backend/db/migrations/0021p_zell_erp_access.sql`

0021-P محوّل ZELL `zell_erp_*` · 983 سطر

| السطر | القسم |
| ---: | --- |
| 21 | BEGIN |
| 22 | بداية الجسم المنسوخ: 0021P ADAPTER BODY |
| 26 | (0) preflight — DO $zpre$ |
| 88 | (1) الدور |
| 89 | دور zell_erp_definer |
| 92 | DO $zrole$ |
| 109 | (2) العدّاد وسجل admin_users (مالكهم postgres، RLS من غير policies، وصفر صلاحيات لأي دور تاني) |
| 112 | جدول zell_erp_owner_guard |
| 119 | جدول zell_erp_admin_users_log |
| 144 | (3) دوال الـ triggers (مالكها postgres) |
| 146 | دالة zell_erp_owner_guard_no_direct |
| 165 | دالة zell_erp_trg_immutable |
| 175 | دالة zell_erp_admin_users_user_id_immutable |
| 189 | دالة zell_erp_owner_guard_count |
| 222 | دالة zell_erp_admin_users_no_truncate |
| 233 | دالة zell_erp_admin_users_log_change |
| 291 | (4) الدوال المساعدة الضيقة (مالكها postgres، EXECUTE لـ zell_erp_definer بس) |
| 292 | دالة zell_erp_admin_status |
| 306 | دالة zell_erp_admin_set_active |
| 324 | دالة zell_erp_admin_list |
| 336 | دالة zell_erp_owner_guard_lock |
| 353 | دالة zell_erp_owner_guard_read |
| 380 | (5) الواجهة: نفس الشكل والخصائص، والجسم بس اللي بيتغيّر. المالك بيبقى zell_erp_definer. |
| 390 | دالة erp_actor_status_v1 |
| 401 | DO $ziface$ |
| 429 | (6) الحد العام: الهوية من جلسة المستخدم، مش من المستدعي. |
| 440 | دالة zell_erp_trusted_actor |
| 470 | دالة zell_erp_require_actor |
| 491 | دالة zell_erp_my_access |
| 503 | دالة zell_erp_access_grant |
| 515 | دالة zell_erp_access_revoke |
| 527 | دالة zell_erp_access_apply_preset |
| 539 | دالة zell_erp_access_revoke_all |
| 551 | دالة zell_erp_access_snapshot |
| 563 | دالة zell_erp_access_audit_page |
| 575 | دالة zell_erp_access_shadow_report |
| 589 | دالة zell_erp_record_shadow_event |
| 609 | دالة zell_erp_set_user_active |
| 683 | دالة zell_erp_access_users |
| 704 | دالة zell_erp_access_parity |
| 830 | (7) صلاحيات ZELL والقوالب |
| 870 | (8) المنح الصريح لكل أدمن شغال (لقطة من القالب)، بسطر سجل مصدره migration. — DO $zseed$ |
| 893 | (9) postflight — DO $zpost$ |
| 982 | نهاية الجسم المنسوخ: 0021P ADAPTER BODY |
| 983 | COMMIT |

## `backend/db/migrations/0021tr2_track_order_v2_ptest.sql`

TRACK-ORDER v2 W1 اختبار قبل التطبيق (الجسم منسوخ بالحرف، 9 حالات؛ على Production 8 + skip T09، والنتيجة صفوف) · 960 سطر

| السطر | القسم |
| ---: | --- |
| 12 | begin; |
| 19 | create function pg_temp.zt(p_name text, p_ok boolean, p_detail text) |
| 25 | create function pg_temp.zt_skip(p_name text, p_detail text) |
| 32 | create function pg_temp.call_as(p_role text, p_sub text, p_sql text) |
| 55 | create function pg_temp.privs() returns text language sql as $f$ |
| 73 | create function pg_temp.fns() returns text language sql as $f$ |
| 81 | do $zguard$ |
| 114 | -- >>> 0021TR2 BODY |
| 118 | -- (0) preflight: المتصل · الموافقة · المتطلبات (A1 · P1 · TR · EXPRESS) · مش متطبّق (الأسماء فاضية … |
| 121 | do $tr2pre$ |
| 175 | -- (1) الجداول (مالكها postgres): RLS + policy لـ zell_order_definer بس، وصفر صلاحيات لـ anon و auth… |
| 179 | create table public.zell_order_shipments ( |
| 202 | create table public.zell_order_shipments_log ( |
| 212 | create table public.zell_order_customer_updates ( |
| 227 | create table public.zell_order_customer_updates_log ( |
| 261 | -- (2) الثبات: السجلين append-only (مفيش UPDATE ولا DELETE ولا TRUNCATE)، والشحنة والرسالة مابيتمسحو… |
| 263 | create function public.zell_shipment_trg_append_only() |
| 269 | create function public.zell_customer_update_trg_append_only() |
| 295 | -- (3) الدوال: CREATE كـ zell_order_definer (SET LOCAL ROLE). الأسماء zell_shipment_* و zell_custome… |
| 303 | create function public.zell_shipment_result(p_order_id integer) |
| 320 | create function public.zell_shipment_get(p_order_number text) |
| 339 | create function public.zell_shipment_save(p_order_number text, p_expected_updated_at timestamptz, p_… |
| 415 | create function public.zell_customer_update_result(p_order_id integer) |
| 429 | create function public.zell_customer_update_text(p_text text) |
| 441 | create function public.zell_customer_update_list(p_order_number text) |
| 456 | create function public.zell_customer_update_add(p_order_number text, p_text text) |
| 482 | create function public.zell_customer_update_edit(p_order_number text, p_update_id bigint, p_expected… |
| 519 | create function public.zell_customer_update_set_hidden(p_order_number text, p_update_id bigint, p_ex… |
| 570 | -- (4) zell_checkout_track_order: CREATE OR REPLACE بنفس الاسم والتوقيع والمالك والإعدادات (والصلاحي… |
| 574 | create or replace function public.zell_checkout_track_order(p_order_number text) |
| 676 | -- (5) postflight |
| 677 | do $tr2post$ |
| 770 | -- <<< 0021TR2 BODY |
| 772 | do $zT$ |
| 893 | do $zC$ |
| 960 | rollback; |

## `backend/db/migrations/0021tr2_track_order_v2_rollback.sql`

TRACK-ORDER v2 W1 الرجوع (دالة التتبّع بجسم T1 بالحرف؛ بيرفض بأي شحنة أو رسالة أو سطر سجل) — أقل من 20 KB · 154 سطر

| السطر | القسم |
| ---: | --- |
| 13 | begin; |
| 17 | do $tr2rb$ |
| 51 | do $tr2rbdata$ |
| 64 | create or replace function public.zell_checkout_track_order(p_order_number text) |
| 120 | do $tr2rbpost$ |
| 154 | commit; |

## `backend/db/migrations/0021tr2_track_order_v2_verify.sql`

TRACK-ORDER v2 W1 التحقق بعد التطبيق (10 فحوص، والنتيجة صفوف) — أقل من 20 KB · 170 سطر

| السطر | القسم |
| ---: | --- |
| 10 | begin; |
| 170 | rollback; |

## `backend/db/migrations/0021tr2_track_order_v2.sql`

TRACK-ORDER v2 W1 التتبّع الكامل: جدولين + سجلاتهم · الحراس · `zell_shipment_get` / `_save` · `zell_customer_update_list` / `_add` / `_edit` / `_set_hidden` · `zell_checkout_track_order` (v2) · 685 سطر

| السطر | القسم |
| ---: | --- |
| 27 | begin; |
| 28 | -- >>> 0021TR2 BODY |
| 32 | -- (0) preflight: المتصل · الموافقة · المتطلبات (A1 · P1 · TR · EXPRESS) · مش متطبّق (الأسماء فاضية … |
| 35 | do $tr2pre$ |
| 89 | -- (1) الجداول (مالكها postgres): RLS + policy لـ zell_order_definer بس، وصفر صلاحيات لـ anon و auth… |
| 93 | create table public.zell_order_shipments ( |
| 116 | create table public.zell_order_shipments_log ( |
| 126 | create table public.zell_order_customer_updates ( |
| 141 | create table public.zell_order_customer_updates_log ( |
| 175 | -- (2) الثبات: السجلين append-only (مفيش UPDATE ولا DELETE ولا TRUNCATE)، والشحنة والرسالة مابيتمسحو… |
| 177 | create function public.zell_shipment_trg_append_only() |
| 183 | create function public.zell_customer_update_trg_append_only() |
| 209 | -- (3) الدوال: CREATE كـ zell_order_definer (SET LOCAL ROLE). الأسماء zell_shipment_* و zell_custome… |
| 217 | create function public.zell_shipment_result(p_order_id integer) |
| 234 | create function public.zell_shipment_get(p_order_number text) |
| 253 | create function public.zell_shipment_save(p_order_number text, p_expected_updated_at timestamptz, p_… |
| 329 | create function public.zell_customer_update_result(p_order_id integer) |
| 343 | create function public.zell_customer_update_text(p_text text) |
| 355 | create function public.zell_customer_update_list(p_order_number text) |
| 370 | create function public.zell_customer_update_add(p_order_number text, p_text text) |
| 396 | create function public.zell_customer_update_edit(p_order_number text, p_update_id bigint, p_expected… |
| 433 | create function public.zell_customer_update_set_hidden(p_order_number text, p_update_id bigint, p_ex… |
| 484 | -- (4) zell_checkout_track_order: CREATE OR REPLACE بنفس الاسم والتوقيع والمالك والإعدادات (والصلاحي… |
| 488 | create or replace function public.zell_checkout_track_order(p_order_number text) |
| 590 | -- (5) postflight |
| 591 | do $tr2post$ |
| 684 | -- <<< 0021TR2 BODY |
| 685 | commit; |

## `backend/db/migrations/0021tr_track_order_ptest.sql`

0021-TR W1 اختبار قبل التطبيق (smoke، 6 حالات، والنتيجة صفوف) — أقل من 20 KB · 261 سطر

| السطر | القسم |
| ---: | --- |
| 9 | begin; |
| 13 | do $zguard$ |
| 23 | create function pg_temp.zt(p_name text, p_ok boolean, p_detail text) |
| 30 | create function pg_temp.call_as(p_role text, p_code text) returns text language plpgsql as $f$ |
| 45 | -- >>> 0021TR BODY |
| 49 | -- (0) preflight: المتصل · الموافقة · مش متطبّق قبل كده · المتطلبات (A1 · D · P1 · P2 · D2). |
| 50 | do $trpre$ |
| 91 | -- (1) قراية order_items للدالة: الأعمدة التمانية اللي في الإسقاط بس + policy قراية لـ zell_order_definer. |
| 97 | -- (2) الدالة: مالكها zell_order_definer، EXECUTE لـ service_role بس — زي zell_checkout_delivery_periods و |
| 102 | create function public.zell_checkout_track_order(p_order_number text) |
| 144 | -- (3) postflight |
| 145 | do $trpost$ |
| 186 | -- <<< 0021TR BODY |
| 188 | do $zT$ |
| 261 | rollback; |

## `backend/db/migrations/0021tr_track_order_rollback.sql`

0021-TR W1 الرجوع (الدالة والـ policy وصلاحيات الأعمدة على `order_items`؛ بيرفض طول ما TRACK-ORDER v2 متطبّق) — أقل من 20 KB · 45 سطر

| السطر | القسم |
| ---: | --- |
| 7 | begin; |
| 11 | do $trrb$ |
| 33 | do $trrbpost$ |
| 45 | commit; |
## `backend/db/migrations/0021tr_track_order_verify.sql`

0021-TR W1 التحقق بعد التطبيق (7 فحوص، النداءات بدور `service_role`، بحالتين قبل/بعد TRACK-ORDER v2، والنتيجة صفوف) — أقل من 20 KB · 230 سطر

| السطر | القسم |
| ---: | --- |
| 14 | begin; |
| 18 | do $trvcall$ |
| 230 | rollback; |
## `backend/db/migrations/0021tr_track_order.sql`

0021-TR W1 «تتبّع طلبك»: قراية `order_items` لـ `zell_order_definer` (٨ أعمدة + policy) · `zell_checkout_track_order` لـ `service_role` — أقل من 20 KB · 168 سطر

| السطر | القسم |
| ---: | --- |
| 25 | begin; |
| 26 | -- >>> 0021TR BODY |
| 30 | -- (0) preflight: المتصل · الموافقة · مش متطبّق قبل كده · المتطلبات (A1 · D · P1 · P2 · D2). |
| 31 | do $trpre$ |
| 72 | -- (1) قراية order_items للدالة: الأعمدة التمانية اللي في الإسقاط بس + policy قراية لـ zell_order_definer. |
| 78 | -- (2) الدالة: مالكها zell_order_definer، EXECUTE لـ service_role بس — زي zell_checkout_delivery_periods و |
| 83 | create function public.zell_checkout_track_order(p_order_number text) |
| 125 | -- (3) postflight |
| 126 | do $trpost$ |
| 167 | -- <<< 0021TR BODY |
| 168 | commit; |

## `docs/contracts/0021-A.md`

عقد 0021-أ: دورة الطلب والتأكيد والسجل والدفعات ورسوم التأكيد · التقسيم والمخاطر · 438 سطر

| السطر | القسم |
| ---: | --- |
| 1 | # عقد 0021-أ — دورة الطلب والتأكيد والدفعات ورسوم التأكيد |
| 14 | ## ٠) القرارات اللي العقد ماشي عليها (منقولة بالحرف تقريبًا، مش جديدة) |
| 31 | ### قرارات المالك على المسودة (2026-10-08) |
| 40 | ### قرارات المالك على أسئلة §١١ (2026-10-08) |
| 57 | ### قرارات المالك (2026-10-09): الترتيب والإطلاق والحالات والمواعيد |
| 69 | ## ١) الوضع النهارده (اللي بنبني عليه) |
| 79 | ## ٢) دورة الطلب |
| 81 | ### ٢-١ الحالات والانتقالات |
| 105 | ### ٢-٢ أمر التجهيز |
| 110 | ### ٢-٣ التعديل قبل التأكيد |
| 117 | ### ٢-٤ التأكيد بالتليفون |
| 127 | ### ٢-٥ السجل (تاريخ الطلب) |
| 136 | ### ٢-٦ منع المسح |
| 141 | ### ٢-٧ الحالات الجديدة في النظام كله (قرار المالك ٢، 2026-10-09) |
| 155 | ### ٢-٨ مواعيد التسليم (قرار المالك ٥، 2026-10-09) |
| 171 | ## ٣) الدفعات |
| 173 | ### ٣-١ جدول الدفعات |
| 181 | ### ٣-٢ حالة الدفع (مشتقة، مش عمود حر) |
| 187 | ### ٣-٣ رسوم تأكيد الطلب |
| 207 | ### ٣-٤ الاستلام والتحصيل |
| 213 | ### ٣-٥ طرق الدفع (قايمة قابلة للتخصيص) |
| 220 | ## ٤) سعر التركيب للمقاس — عقد مالي مستقل |
| 225 | ## ٥) الصلاحيات والهوية |
| 233 | ## ٦) `zell_create_order` — المخاطر وبروتوكول الفلوس |
| 237 | ### ٦-١ البروتوكول (`04-DB-SAFETY.md` + دروس 0021-P) — إلزامي |
| 253 | ### ٦-٢ المخاطر |
| 270 | ## ٧) تقسيم التنفيذ (PR واحد في المرة) |
| 290 | ### ٧-١ الدومين (قرار المالك ٦، 2026-10-09) |
| 295 | ## ٨) معايير القبول |
| 304 | ## ٩) الرجوع |
| 312 | ## ١٠) برّه النطاق |
| 316 | ## ١١) أسئلة للمالك (مش محسومة — العقد مش هيفترض إجابة) |
| 339 | ## ١٢) قرارات تقنية للمراجع |
| 350 | ## ١٣) سجل التعديلات |
| 364 | ## ١٤) تفاصيل تنفيذ A1 (`backend/db/migrations/0021a_a1_order_cycle.sql`) |
| 381 | ## ١٥) تفاصيل تنفيذ A2 (اللوحة + `@zell/core`) |
| 397 | ## ١٦) تفاصيل تنفيذ D (`backend/db/migrations/0021d_preferred_delivery.sql`) |
| 409 | ## ١٧) تفاصيل تنفيذ P1 (`backend/db/migrations/0021a_p1_payments.sql`) |
| 426 | ## ١٨) تفاصيل تنفيذ P2 (اللوحة · المتجر · `backend/db/migrations/0021a_p2_checkout_fee.sql`) |

## `docs/contracts/0021-P-code.md`

عقد كود 0021-P: أ ← ب1 ← ب2 · الأوضاع · الفاحص · التعديلات بعد الاعتماد · 249 سطر

| السطر | القسم |
| ---: | --- |
| 1 | # عقد 0021-P — الكود (اللوحة) |
| 14 | ## ١) الهدف |
| 33 | ## ٢) نموذج النداء: جلسة المستخدم، مش service_role |
| 45 | ## ٣) الأوضاع (`ADMIN_ACCESS_MODE`) |
| 58 | ## ٤) PR (أ): نقل دوال القراءة من `lib/mutations` لـ `lib/data` (refactor بس) |
| 111 | ## ٥) PR (ب1): الأساس + الفاحص بيبلّغ |
| 144 | ## ٦) قواعد الفاحص (`check-access.mjs`) |
| 164 | ## ٧) PR (ب2): التغليف + الفاحص بيمنع |
| 199 | ## ٨) بعد ب2 (مش في الـ PRs دي، وكل خطوة قرار منفصل) |
| 208 | ## ٩) ممنوع في الـ PRs التلاتة |
| 218 | ## ١٠) تعديلات بعد الاعتماد |
| 220 | ### 2026-10-08 · اكتشافات تنفيذ (ب1) — محتاجة موافقة المراجع |
| 229 | ### 2026-10-08 · قرارات المراجع على `cfa3124` (اتطبّقت في ب1) |
| 237 | ### 2026-10-08 · تصحيح سطر «الحالة» (توثيق بس) |
| 241 | ### 2026-10-08 · اكتشافات تنفيذ (ب2) — محتاجة موافقة المراجع |

## `docs/contracts/0021-P.md`

عقد 0021-P (الداتابيز): المحرك والمحوّل والهوية من الجلسة · 252 سطر

| السطر | القسم |
| ---: | --- |
| 1 | # عقد 0021-P — الصلاحيات (المحرك العام + محوّل ZELL) |
| 17 | ## ١) الهدف والنطاق |
| 23 | ## ٢) التقسيم |
| 34 | ## ٣) الهوية: من الجلسة، مش من المستدعي |
| 45 | ## ٤) الأدوار والصلاحيات في الداتابيز |
| 56 | ## ٥) الحد العام: ١٢ دالة (EXECUTE لـ `authenticated` بس) |
| 73 | ## ٦) الصلاحيات والقوالب |
| 117 | ## ٧) الإدارة: idempotency والتزامن |
| 126 | ## ٨) حماية آخر مالك |
| 138 | ## ٩) السجلات |
| 149 | ## ١٠) الأكواد |
| 170 | ## ١١) الرجوع (`0021p_access_rollback.sql`) |
| 187 | ## ١٢) قرارات المراجع (متثبّتة) |
| 198 | ## ١٣) الاختبارات والنتايج |
| 200 | ### Spike (`chore/0021p-access-spike` على `8260b53`، والفرع اتمسح) |
| 207 | ### CI (Postgres 17 مؤقت، job `sql-0021p`) |
| 217 | ### الـ ptest على Production |
| 226 | ### التطبيق على Production (head `da273c4`، بعد backup كامل عند المالك) |
| 240 | ## ١٤) الأثر على PR الكود الجاي |
| 250 | ## ١٥) سؤال مفتوح |

## `docs/contracts/EXPRESS-SHIPPING.md`

عقد الشحن السريع ومدة الشحن: الإعداد `zell_shipping_options` · `zell_create_order` (15) واللقطة · Checkout والـ canonical · فحوص التحقق المتأثرة · قراءات R1–R6 ونتايجها · تفاصيل W1 و W2 · 194 سطر

| السطر | القسم |
| ---: | --- |
| 1 | # عقد EXPRESS-SHIPPING — الشحن السريع ومدة الشحن في Checkout |
| 12 | ## ٠) قرار المالك (2026-10-14) |
| 23 | ## ١) الوضع النهارده (من الريبو على `c825ce3`) |
| 31 | ## ٢) الميزة |
| 33 | ### ٢-١ الإعداد — جدول لوحده (مش مفتاح في `settings`) |
| 45 | ### ٢-٢ الدوال (أسماء برّه كل العدّادات) |
| 52 | ### ٢-٣ الطلب (`zell_create_order` — البروتوكول الكامل، عقد 0021-A §٦-١) |
| 67 | ### ٢-٤ المتجر (W2) |
| 78 | ### ٢-٥ اللوحة (W2) — شاشة شحن واحدة |
| 84 | ## ٣) الأكواد |
| 88 | ## ٤) الحساب (المرجع الوحيد = الداتابيز) |
| 94 | ## ٥) الرجوع |
| 100 | ## ٦) الاختبارات |
| 109 | ### ٦-١ فحوص التحقق اللي بتعتمد على توقيع وبصمة `zell_create_order` (جزء من W1) |
| 127 | ## ٧) قراءات Production المطلوبة قبل اعتماد العقد (قراءة بس، **كل واحدة بموافقة منفصلة**) |
| 139 | ### ٧-١ النتايج (2026-10-14 — قراءة بس، كل واحدة بموافقة لوحدها، ومفيش أي فرق عن الريبو) |
| 150 | ### ٧-٢ W1 (SQL + CI) — الملفات والتفاصيل اللي اتحددت في الـ PR |
| 161 | ### ٧-٣ W2 (اللوحة والمتجر) — التفاصيل اللي اتحددت في الـ PR |
| 169 | ## ٨) التقسيم والموافقات (PR واحد في المرة) |
| 177 | ## ٩) برّه النطاق |
| 180 | ## ١٠) قرارات المالك (2026-10-14 — كانت أسئلة واتحسمت) |
| 188 | ## ١١) سجل التعديلات |
## `docs/contracts/TRACK-ORDER-v2.md`

عقد التتبّع الكامل: حقول v1 + v2 · المبالغ (المدفوع · المردود · الصافي · المتبقي) · خط المراحل · الشحنة · رسايل العميل · الموعد · قراءات T1–T5 ونتايجها · W1 (الأسماء والأكواد النهائية) · 203 سطر

| السطر | القسم |
| ---: | --- |
| 1 | # عقد TRACK-ORDER v2 — التتبّع الكامل في «تتبّع طلبك» |
| 13 | ## ٠) قرار المالك (2026-10-14) |
| 21 | ## ١) استثناءات من عقد TRACK-ORDER (بيعدّلها v2 بقرار المالك) |
| 31 | ## ٢) الرد الجديد (W1 — نفس الاسم والتوقيع والمالك والصلاحيات) |
| 32 | ### ٢-١ حقول v1 — زي ما هي بالحرف ومعانيها |
| 42 | ### ٢-٢ حقول v2 الجديدة (جنب حقول v1) |
| 54 | ## ٣) المبالغ — المدفوع والمردود والصافي والمتبقي منفصلين |
| 71 | ## ٤) خط المراحل (منطق خالص في المتجر) |
| 87 | ## ٥) الشحنة — بيان لوحده، مش تغيير حالة |
| 93 | ## ٦) رسايل العميل |
| 99 | ## ٧) الخطوة التالية (منطق خالص في المتجر) |
| 111 | ## ٨) الموعد (من غير أي تخمين) |
| 119 | ## ٩) زرار واتساب |
| 123 | ## ١٠) الأمان والمخاطر |
| 129 | ## ١١) قراءات Production المطلوبة قبل اعتماد العقد (قراءة بس، كل واحدة بموافقة منفصلة) |
| 138 | ### ١١-١ النتايج (2026-10-14 — قراءة بس، كل واحدة بموافقة لوحدها، ومفيش أي فرق عن الريبو) |
| 148 | ## ١٢) التقسيم والموافقات |
| 155 | ## ١٣) الرجوع |
| 158 | ## ١٤) قرارات المالك (2026-10-14 — كانت أسئلة واتحسمت) |
| 170 | ## ١٥) سجل التعديلات |
| 175 | ## ١٦) W1 (SQL + CI) — الأسماء والأكواد النهائية والتفاصيل اللي اتحددت في الـ PR |
## `docs/maps/db-map.md`

خريطة الداتابيز: كل دور وجدول ودالة ومتعرّف في أنهي ملف · 373 سطر

| السطر | القسم |
| ---: | --- |
| 1 | # خريطة الداتابيز |
| 13 | ## ١) الأدوار |
| 29 | ## ٢) الجداول |
| 31 | ### المتجر والطلبات |
| 54 | ### دورة الطلب (0021-A A1) |
| 66 | ### موعد التسليم في Checkout (0021-D2 W1 — مش متطبّق لسه) |
| 75 | ### الشحن السريع ومدة الشحن (EXPRESS-SHIPPING W1 — مش متطبّق لسه) |
| 82 | ### الشحنة ورسايل العميل (TRACK-ORDER v2 W1 — مش متطبّق لسه) |
| 93 | ### المخزون والمشتريات (0020) |
| 110 | ### الصلاحيات (0021-P) |
| 126 | ## ٣) دوال المتجر والطلب |
| 142 | ## ٤) دوال اللوحة (الكتابة الذرّية) |
| 164 | ## ٥) دوال المخزون (0020، مالكها `zell_inventory_definer`) |
| 192 | ## ٦) دوال الصلاحيات (0021-P) |
| 196 | ### المحرك (`0021p_erp_access.sql`، مالكها `erp_definer`، كلها داخلية) |
| 208 | ### المحوّل (`0021p_zell_erp_access.sql`) |
| 217 | ### Triggers 0021-P |
| 228 | ## ٧) دوال دورة الطلب (0021-A A1، مالكها `zell_order_definer`) |
| 241 | ## ٧-ب) دوال الدفعات ورسوم التأكيد (0021-A P1 و P2) |
| 271 | ## ٧-ج) دوال موعد التسليم في Checkout (0021-D2 W1) |
| 291 | ## ٨) ملفات من غير جداول أو دوال جديدة |
| 305 | ## ٩) تتبّع الطلب للعميل (0021-TR W1) |
| 325 | ## ١٠) الشحن السريع ومدة الشحن (EXPRESS-SHIPPING W1) |
| 348 | ## ١١) التتبّع الكامل: الشحنة ورسايل العميل (TRACK-ORDER v2 W1) |
## `docs/plans/ADMIN-LANG-LIST.md`

حصر نصوص اللوحة العامية مع مقترح فصحى مبسّطة لكل نص (أ · ب · ج · د)، للمالك يختار منه · 224 سطر

| السطر | القسم |
| ---: | --- |
| 1 | # حصر نصوص اللوحة العامية — للاختيار |
| 6 | ## النطاق (قرار المالك) |
| 11 | ## العلامات |
| 23 | ## أ) عامية واضحة وجمل طويلة بتكلّم المستخدم (الأوضح) |
| 81 | ## ب) شروحات قصيرة ومتوسطة تحت الحقول وجوه الصفحات |
| 155 | ## ج) جمل قصيرة وحالات فاضية (الأقل) |
| 178 | ## د) رسايل خطأ وتحذير من `lib/` (بتظهر للمستخدم، وعامية) |
| 215 | ## طريقة الحصر |
| 221 | ## الخطوة الجاية |

## `docs/plans/ORDER-FLOW-PLAN.md`

خطة مسار الطلب · 1584 سطر

| السطر | القسم |
| ---: | --- |
| 1 | # FUTURE IMPLEMENTATION PLAN — NOT EXECUTED |
| 19 | ## ملخّص تنفيذي |
| 50 | ## 0. حالة البداية والقرارات |
| 78 | ### 0.1 مفيش أي migration للطلب على Production — **أرشيف: الحالة قبل التنفيذ** |
| 99 | ### 0.2 ملاحظات بنية مؤثّرة |
| 118 | ### 0.3 الفرجات المكتشفة |
| 131 | ### 0.4 التوجيهات المعتمدة — الجولة الأولى |
| 143 | ### 0.5 التبسيطات المعتمدة — الجولة التانية |
| 155 | ### 0.6 ب٨ — صفر أسرار في أي URL |
| 160 | ### 0.7 ب٩ — الكوكي في نفس رد الـAPI |
| 166 | ### 0.8 القرارات النهائية — الجولة الخامسة (ب١٠ · ب١١ · ب١٢) |
| 291 | ### 0.9 القرارات النهائية — الجولة السادسة (ب١٤) |
| 318 | ## 1. العقود (TypeScript) |
| 322 | ### 1.1 الطلب |
| 341 | ### 1.2 الرد — صفر أسرار |
| 373 | ### 1.3 جدول الأكواد ← HTTP ← الرسالة العربية الثابتة |
| 437 | ## 2. طبقة الداتابيز — ستة أعمدة ودالتين |
| 439 | ### 2.1 المسوّدات القديمة: مرفوضة للتنفيذ (ت٤) |
| 469 | ### 2.2 `0006a` — الأعمدة الستة |
| 498 | ### 2.3 `0006b` — الدور: صفر صلاحيات على الجداول (ت٧ + ب١) |
| 520 | ### 2.4 دلالة الشحن الموحّدة (ت٣ + ت٦) |
| 532 | ### 2.5 مولّد رقم الطلب: اتدمج، وفحص الوجود اتشال (ب١) |
| 538 | ### 2.6 نقطة أمانة لازم تتكرر في الوثائق |
| 546 | ## 3. `zell_create_order` — كل حاجة جوه معاملة واحدة |
| 548 | ### 3.1 القاعدة |
| 552 | ### 3.2 التوقيع |
| 567 | ### 3.3 التسلسل — الترتيب نفسه جزء من الصحّة (ب١٣) |
| 640 | ### 3.4 ملاحظات ذرّية |
| 665 | ## 4. الـidempotency والتفويض |
| 667 | ### 4.1 المفتاح (العميل) — **مش سر، ومش كفاية** |
| 678 | ### 4.2 الهاش (السيرفر فقط) |
| 717 | ### 4.3 سلوك السيرفر |
| 743 | ### 4.4 التزامن — صح مهما كان ترتيب الوصول (ب١١) |
| 771 | ### 4.5 نموذج التفويض — إثبات مرتبط بالمتصفح (ب١٠) |
| 848 | ## 5. تحديد المعدّل (ب٢) |
| 850 | ### 5.1 القرار |
| 856 | ### 5.2 اللي موجود فعلاً |
| 871 | ### 5.3 المخاطرة المتبقية — مكتوبة صريح |
| 885 | ## 6. الوصول للإيصال (ب٨ + ب٩ + ب١١ + ب١٢) |
| 887 | ### 6.1 السر: عشوائي، والداتابيز فيها الـhash بس |
| 902 | ### 6.2 ليه الكوكي وليه مش الـURL ولا الـJSON |
| 914 | ### 6.3 ضبط الكوكي — خطوة واحدة |
| 934 | ### 6.4 مواصفات كوكي الإيصال |
| 966 | ### 6.4ب 🔴 blocker قبل التفعيل — صلاحية الكوكي على الـreplay (ب١٥) |
| 1025 | ### 6.5 صفحة الإيصال |
| 1041 | ### 6.6 الإسقاط — التقنيع في الداتابيز |
| 1052 | ### 6.7 حالة «الإيصال غير متاح» — واحدة لكل الأسباب |
| 1067 | ### 6.8 التنضيف |
| 1073 | ## 7. الإشعار |
| 1100 | ### 7.1 قاعدة ثابتة |
| 1105 | ### 7.2 التوقيت، والـreplay (ب٦) |
| 1132 | ### 7.3 الأساسي: تليجرام — متغيرات بيئة فقط (ت١ + ب٧) |
| 1181 | ### 7.4 `notify_email` — غير سرّي، وفاضي حالياً (ت٢) |
| 1189 | ### 7.5 التسجيل |
| 1218 | ### 7.6 اللوج |
| 1228 | ## 8. الملفات بالتحديد |
| 1230 | ### جديد |
| 1253 | ### معدّل |
| 1268 | ### منقول لـ`docs/legacy/` — التاريخ ما يتحذفش (ب٥ + ق٥) |
| 1286 | ## 9. النشر والتراجع |
| 1288 | ### 9.1 بوّابة التشغيل |
| 1300 | ### 9.2 الترتيب |
| 1338 | ### 9.3 التراجع |
| 1350 | ### 9.4 ترتيب نقل تليجرام (ب٧) — ملخّص |
| 1361 | ## 10. مصفوفة الاختبار |
| 1368 | ### 10.1 الطلب والتسعير |
| 1396 | ### 10.2 الإشعار |
| 1405 | ### 10.3 التفويض — ب١٠ |
| 1423 | ### 10.4 ترتيب الردود — ب١١ |
| 1432 | ### 10.5 الإيصال — ب٨ · ب٩ · ب١٢ |
| 1453 | ### 10.6 الصلاحيات والتسريب والتشغيل |
| 1473 | ### 10.7 تصحيحات ب١٣ — ترتيب الحسم · ذرّية الحد · الـoverflow |
| 1493 | ### 10.8 تصحيحات ب١٤ — التحقق الذاتي والتسمية والعزل |
| 1506 | ## 11. القرارات النهائية |
| 1508 | ### 11.1 الأسئلة الثمانية — كلها مُجابة ومقفولة |
| 1523 | ### 11.2 التحفّظات المسجّلة |
| 1541 | ## 12. حالة الفحوصات على PR #21 — **مش فشل كود** |
| 1561 | ## ملحق — مصادر الفحص |

## `README.md`

حالة النظام الحي: الميزات · اللوحة · الهيكل · الأمان · التوثيق · 325 سطر

| السطر | القسم |
| ---: | --- |
| 1 | # ZELL — متجر أفلام الزجاج بالمتر |
| 15 | ## الحالة الحالية |
| 45 | ## الميزات: إيه اللي شغّال وإيه اللي لأ |
| 69 | ## اللوحة: كل حاجة بتتعدّل منين |
| 106 | ## الهيكل |
| 130 | ### 📦 `backend/` و `frontend/` |
| 144 | ## التشغيل محليًا |
| 164 | ## النشر |
| 177 | ## منطق التسعير |
| 197 | ## قاعدة البيانات |
| 240 | ## قواعد الأمان — ملزمة |
| 260 | ## التوثيق |
| 262 | ### الوضع الحالي — ابدأ من هنا |
| 270 | ### مراجع تفصيلية |
| 284 | ### خطة مستقبلية — **مش منفّذة** |
| 294 | ### أرشيف تاريخي |
| 304 | ## اللي لسه ناقص |
