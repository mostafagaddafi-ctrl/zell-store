#!/usr/bin/env bash
# =====================================================================
# backend/db/ci/start_postgres17.sh — CI ONLY (GitHub-hosted Ubuntu runner).
# Why: the postgres:17 service container could not be pulled: public.ecr.aws answered
#      "toomanyrequests: Data limit exceeded" (PR #176, run 40126218800, attempts 1 and 2) before any test ran.
# What: installs PostgreSQL 17 (server + client) from the OFFICIAL PostgreSQL apt repository (apt.postgresql.org).
#      The repository key is pinned by fingerprint; apt verifies every package signature (never disabled, no
#      --allow-unauthenticated). No package may start a service during the install (policy-rc.d), the package's default
#      cluster is never used, and the script refuses if port 5432 is already taken by anything else.
#      Then it starts a NEW, dedicated, throwaway cluster for the tests under $RUNNER_TEMP.
# Contract for the tests (same as the old service container): localhost:5432 · superuser supabase_admin · password =
#      PGPASSWORD from the job env (throwaway "ci") · scram-sha-256 · UTF8. It creates NO other role: postgres and every
#      other role / setting stay the job of the existing tests.
# NOT identical to the Debian-based postgres:17 image: Ubuntu runner, packages from apt.postgresql.org, locale en_US.UTF-8.
# Any failure stops the job here (set -euo pipefail + explicit checks): no test is skipped, nothing is counted as passed.
# Checked and recorded (job log "ZELL_PG17_CHECK ..." + job summary): server 17 · client 17 · UTF8 · locale ·
#      local connection · password authentication (a wrong password is refused) · superuser · no other role.
# =====================================================================
set -euo pipefail

fail() { echo "ZELL_PG17_SETUP_FAILED: $*" >&2; exit 1; }

[ "${GITHUB_ACTIONS:-}" = "true" ] || fail "GitHub Actions runner only"
[ "${ZELL_CI_DISPOSABLE_DB:-}" = "yes" ] || fail "ZELL_CI_DISPOSABLE_DB must be yes"
[ "${PGHOST:-}" = "localhost" ] || fail "PGHOST must be localhost"
[ "${PGPORT:-}" = "5432" ] || fail "PGPORT must be 5432"
[ "${CI_SUPERUSER:-}" = "supabase_admin" ] || fail "CI_SUPERUSER must be supabase_admin"
[ -n "${PGPASSWORD:-}" ] || fail "PGPASSWORD must be set by the job"
[ -n "${RUNNER_TEMP:-}" ] || fail "RUNNER_TEMP is not set"

PGDG_KEY_URL=https://www.postgresql.org/media/keys/ACCC4CF8.asc
PGDG_KEY_FPR=B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
KEYRING=/usr/share/keyrings/zell-pgdg.asc
CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")
[ -n "$CODENAME" ] || fail "cannot read the Ubuntu codename"
BASE="$RUNNER_TEMP/zell-pg17"
DATA="$BASE/data"
SOCK="$BASE/sock"
BIN=/usr/lib/postgresql/17/bin

# ---- 1) official repository, key pinned by fingerprint ----
mkdir -p "$BASE"
curl -fsSL --retry 3 "$PGDG_KEY_URL" -o "$BASE/pgdg.asc"
fpr=$(gpg --show-keys --with-colons "$BASE/pgdg.asc" 2>/dev/null | awk -F: '$1 == "fpr" {print $10; exit}')
[ "$fpr" = "$PGDG_KEY_FPR" ] || fail "PostgreSQL apt key fingerprint mismatch (got '$fpr')"
sudo install -D -m 0644 "$BASE/pgdg.asc" "$KEYRING"
echo "deb [signed-by=$KEYRING] https://apt.postgresql.org/pub/repos/apt $CODENAME-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/zell-pgdg.list > /dev/null

# ---- 2) the install must not start any service nor create the package's default cluster ----
printf '#!/bin/sh\nexit 101\n' | sudo tee /usr/sbin/policy-rc.d > /dev/null
sudo chmod 0755 /usr/sbin/policy-rc.d
trap 'sudo rm -f /usr/sbin/policy-rc.d' EXIT
sudo mkdir -p /etc/postgresql-common
echo 'create_main_cluster = false' | sudo tee -a /etc/postgresql-common/createcluster.conf > /dev/null

# ---- 3) install PostgreSQL 17 server + client (signatures verified by apt) ----
sudo apt-get update -o Acquire::Retries=3
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends -o Acquire::Retries=3 \
  -o APT::Get::AllowUnauthenticated=false postgresql-17 postgresql-client-17
[ -x "$BIN/postgres" ] && [ -x "$BIN/initdb" ] && [ -x "$BIN/pg_ctl" ] || fail "PostgreSQL 17 binaries missing after install"
if pg_lsclusters -h 2>/dev/null | awk '$1 == "17"' | grep -q .; then
  fail "a packaged PostgreSQL 17 cluster exists; refusing to use or touch it"
fi

# ---- 4) a NEW dedicated test cluster ----
locale -a | grep -qix 'en_US.utf8' || sudo locale-gen en_US.UTF-8 > /dev/null
locale -a | grep -qix 'en_US.utf8' || fail "locale en_US.UTF-8 is not available"
if (exec 3<> /dev/tcp/127.0.0.1/5432) 2> /dev/null; then fail "port 5432 is already in use by another service; refusing"; fi
[ ! -e "$DATA" ] || fail "$DATA already exists"
mkdir -p "$SOCK"
umask 077
printf '%s\n' "$PGPASSWORD" > "$BASE/pw"
"$BIN/initdb" -D "$DATA" -U supabase_admin --pwfile="$BASE/pw" -A scram-sha-256 -E UTF8 --locale=en_US.UTF-8 > "$BASE/initdb.log" 2>&1 \
  || { cat "$BASE/initdb.log" >&2; fail "initdb failed"; }
rm -f "$BASE/pw"
"$BIN/pg_ctl" -D "$DATA" -l "$BASE/server.log" -w -t 60 \
  -o "-c listen_addresses=localhost -p 5432 -c unix_socket_directories=$SOCK" start > "$BASE/pg_ctl.log" 2>&1 \
  || { cat "$BASE/server.log" >&2 || true; fail "the test cluster did not start"; }

# ---- 5) checks — every one must pass, results recorded ----
q() { psql -X -q -tA -v ON_ERROR_STOP=1 -h localhost -p 5432 -U supabase_admin -d postgres -c "$1"; }
FAILS=0
check() {
  local name=$1 value=$2 pattern=$3
  if printf '%s' "$value" | grep -Eqx "$pattern"; then
    echo "ZELL_PG17_CHECK ok $name=$value"
    echo "- ok · $name: \`$value\`" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  else
    echo "ZELL_PG17_CHECK FAIL $name=$value (expected $pattern)"
    echo "- **FAIL** · $name: \`$value\`" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    FAILS=$((FAILS + 1))
  fi
}
echo "### PostgreSQL 17 test cluster (official apt repository, not the Debian image)" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
check client_version "$(psql --version)" 'psql \(PostgreSQL\) 17\.[0-9]+.*'
check server_version_num "$(q 'show server_version_num')" '17[0-9]{4}'
check server_version "$(q 'show server_version')" '17\.[0-9]+.*'
check server_encoding "$(q 'show server_encoding')" 'UTF8'
check database_locale "$(q "select datcollate || '/' || datctype from pg_catalog.pg_database where datname = 'postgres'")" 'en_US\.UTF-8/en_US\.UTF-8'
check local_connection "$(q 'select coalesce(host(pg_catalog.inet_server_addr()), $$socket$$)')" '127\.0\.0\.1|::1'
check superuser "$(q "select current_user || '/' || rolsuper::text from pg_catalog.pg_roles where rolname = current_user")" 'supabase_admin/true'
check other_roles "$(q "select pg_catalog.count(*) from pg_catalog.pg_roles where rolname !~ '^pg_' and rolname <> 'supabase_admin'")" '0'
wrong=accepted
PGPASSWORD=zell-wrong-password psql -X -q -tA -h localhost -p 5432 -U supabase_admin -d postgres -c 'select 1' > /dev/null 2>&1 || wrong=refused
check wrong_password "$wrong" 'refused'
[ "$FAILS" -eq 0 ] || fail "$FAILS check(s) failed"
echo "ZELL_PG17_READY localhost:5432 supabase_admin"
