# BASELINE-OUTSIDE step 0 — isolated test (2026-10-24 12:41 UTC)

- Engine: PostgreSQL 17.10 (embedded-postgres 17.10.0-beta.17) on the QA server, localhost only, unprivileged OS user, synthetic data only (`baseline_step0_test_setup.sql`), data dir deleted after. No connection to Production.
- Driver: node-pg simple protocol. Statements returned: BEGIN, SET x5, SELECT, ROLLBACK.
- Final limits are inlined (no placeholders): the execution transport interpolates double-brace text, so the Production text must contain none.
- Result: 12,119 bytes; `transaction_read_only = on`; identical output across two runs (excluding `at_utc`).
- Sections: q1 6 complete (`missing`: zell_set_primary_product_image; `overloaded`: zell_reorder_products — both intentional in the setup) · q2 columns 5 (column ACL), constraints 2, indexes 2, sequences 1 (identity, dep=i, no counter value), policies 1, triggers 1, table owner/RLS/FORCE RLS/ACL with grantor+grantable · q2_benefits_constraint scoped to public.products · q3 default ACL rows 2 (grantor/grantable) + hard-wired defaults 15 · q4 roles 5, members 2 with inherit_option/set_option (NOINHERIT case: inherit=false set=true) · q5 functions 7, relations 3.
- Limits test (objects=2, inventory=3, def_bytes=120): q1 count=6 complete=false items=2 · q5 count=7 complete=false items=3 · oversized definitions return def=null with def_oversize=true.
- Read-only probe: CREATE TABLE inside a READ ONLY transaction rejected; probe table absent afterwards.
- Open point: the Production channel is the Retool postgres resource `.query()`. Whether it returns the SELECT result of a multi-statement text (BEGIN; SET; SELECT; ROLLBACK) is not verified; needs a tiny approved channel check (e.g. `begin transaction read only; select 1 as ok; rollback;`) or an agreed alternative before step 0.
