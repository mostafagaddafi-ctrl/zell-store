# BASELINE-OUTSIDE step 0 — isolated test, review 2 fixes (2026-10-24)

- Engine: PostgreSQL 17.10 (embedded-postgres 17.10.0-beta.17) on the QA server, localhost only, unprivileged OS user, synthetic data only (`baseline_step0_test_setup.sql`), data dir and package deleted after. No connection to Production.
- Statements returned: BEGIN, SET x5, SELECT, ROLLBACK. `transaction_read_only = on`. Output identical across two runs (excluding `at_utc`). payload_bytes 20,166 (cap 1,000,000), complete=true.

## B1 — sequence code mapping
- Explicit map catalog->acldefault: r->r, S->s, f->f, T->T, n->n (`objmap`); `acldefault_code` is returned with each item.
- Test: hard-wired defaults for creator `postgres`, catalog objtype S = SELECT, UPDATE, USAGE (via `s`) — matches expected.

## B2 — empty default ACL rows and creators
- New section `q3_default_acl_rows`: one item per pg_default_acl row with `acl_items` (cardinality), independent of exploded items. `q3_default_acl` uses LEFT JOIN LATERAL, so an empty ACL keeps one item with grantee/privilege null.
- `postgres` and `supabase_admin` are always included as creators for the hard-wired defaults.
- Test: `creator_empty` (global functions row with empty ACL) -> row present, acl_items=0, item grantee=null; `creator_none` (no rows) -> 0 rows, so hard-wired defaults apply. Two different results.

## B3 — total size cap inside the result
- The whole data object is built first, then measured (`payload_bytes`). Over `payload_cap_bytes` -> a small result with complete=false, stop_reason=payload_over_cap, data=null.
- `complete` at the top = every section complete and no def_oversize; otherwise stop_reason=section_incomplete_or_oversize.
- Tests: cap=3,000 -> payload_over_cap, data=null, 382 bytes received. Limits objects=2/inventory=3/def_bytes=120 -> complete=false, section_incomplete_or_oversize, q1 count=6 items=2 any_oversize=true.
- Rule: complete=false, any stop_reason, or any def_oversize=true = stop; the snapshot is not used and nothing is dropped silently.

- Read-only probe: CREATE TABLE inside a READ ONLY transaction rejected; probe table absent afterwards.
- Channel: historical evidence in 04-DB-SAFETY.md:92-93 (BEGIN; SELECT; ROLLBACK returned rows on 2026-10-07). Same-channel proof for the current `.query()` is not established; a limited channel check needs a separate owner approval.
