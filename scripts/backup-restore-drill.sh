#!/usr/bin/env bash
# Logical backup -> restore -> verify drill against the local compose Postgres (container `leadpilot-postgres-1`).
# Proves a dump can be restored into an EMPTY database and that tenant isolation (RLS), grants, functions and data survive.
# It never touches the source database except to read it. Usage: scripts/backup-restore-drill.sh
set -euo pipefail
cd "$(dirname "$0")/.."
getenv() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'; }
DATABASE_OWNER_URL=$(getenv DATABASE_OWNER_URL); APP_ROLE_PASSWORD=$(getenv APP_ROLE_PASSWORD)
C=${PG_CONTAINER:-leadpilot-postgres-1}
SRC=leadpilot; DST=leadpilot_restore_drill
PGO=(docker exec -e PGPASSWORD="$(echo "$DATABASE_OWNER_URL" | sed -E 's#.*://[^:]+:([^@]*)@.*#\1#')" "$C")
OWNER=$(echo "$DATABASE_OWNER_URL" | sed -E 's#.*://([^:]+):.*#\1#')
q() { "${PGO[@]}" psql -h localhost -U "$OWNER" -d "$1" -At -c "$2"; }
now() { python3 -c 'import time;print(time.time())'; }

echo "== source"; q $SRC "select pg_size_pretty(pg_database_size('$SRC'))"
T0=$(now)
"${PGO[@]}" pg_dump -h localhost -U "$OWNER" -d $SRC -Fc -f /tmp/drill.dump
T1=$(now); echo "dump: $(python3 -c "print(round($T1-$T0,1))") s, $(docker exec "$C" ls -lh /tmp/drill.dump | awk '{print $5}')"

# Database + extensions are created by a SUPERUSER (on RDS: the rds_superuser admin). The owner role cannot create `vector` etc.,
# exactly as in production: the restore runbook has this as its first step.
SU=(docker exec "$C" psql -U postgres -d postgres -At)
"${SU[@]}" -c "drop database if exists $DST" >/dev/null
"${SU[@]}" -c "create database $DST owner $OWNER" >/dev/null
for e in $(q $SRC "select extname from pg_extension where extname <> 'plpgsql'"); do docker exec "$C" psql -U postgres -d $DST -c "create extension if not exists $e" >/dev/null; done
T2=$(now)
# extension COMMENTs need extension ownership (superuser); everything else restores as the owner role
docker exec "$C" sh -c "pg_restore -l /tmp/drill.dump | grep -v 'COMMENT - EXTENSION' > /tmp/drill.list"
"${PGO[@]}" pg_restore -h localhost -U "$OWNER" -d $DST --no-owner --role="$OWNER" --exit-on-error -L /tmp/drill.list /tmp/drill.dump
T3=$(now); echo "restore: $(python3 -c "print(round($T3-$T2,1))") s"

fail=0
check() { local label=$1 a=$2 b=$3; if [ "$a" = "$b" ]; then echo "  ok   $label ($a)"; else echo "  FAIL $label source=$a restored=$b"; fail=1; fi; }
echo "== verify"
for t in tenants users leads lead_activities conversations messages appointments invoices subscriptions plans plan_entitlements audit_logs; do check "rows $t" "$(q $SRC "select count(*) from $t")" "$(q $DST "select count(*) from $t")"; done
check "tables with RLS enabled" "$(q $SRC "select count(*) from pg_class where relrowsecurity and relnamespace='public'::regnamespace")" "$(q $DST "select count(*) from pg_class where relrowsecurity and relnamespace='public'::regnamespace")"
check "RLS policies" "$(q $SRC "select count(*) from pg_policies where schemaname='public'")" "$(q $DST "select count(*) from pg_policies where schemaname='public'")"
check "SECURITY DEFINER functions" "$(q $SRC "select count(*) from pg_proc where prosecdef and pronamespace='public'::regnamespace")" "$(q $DST "select count(*) from pg_proc where prosecdef and pronamespace='public'::regnamespace")"
check "exclusion constraints (no double booking)" "$(q $SRC "select count(*) from pg_constraint where contype='x'")" "$(q $DST "select count(*) from pg_constraint where contype='x'")"
check "app-role table grants" "$(q $SRC "select count(*) from information_schema.role_table_grants where grantee='leadpilot_app' and table_schema='public'")" "$(q $DST "select count(*) from information_schema.role_table_grants where grantee='leadpilot_app' and table_schema='public'")"
check "extensions" "$(q $SRC "select string_agg(extname, ',' order by extname) from pg_extension")" "$(q $DST "select string_agg(extname, ',' order by extname) from pg_extension")"
check "invoice counter" "$(q $SRC "select coalesce(sum(last),0) from invoice_counters")" "$(q $DST "select coalesce(sum(last),0) from invoice_counters")"

echo "== isolation still holds in the restored database (as the APP role, tenant A in scope sees only A)"
A=$(q $DST "select id from tenants where name='Load Test Realty'")
APPPASS=${APP_ROLE_PASSWORD:-}
cnt=$(docker exec -e PGPASSWORD="$APPPASS" "$C" psql -h localhost -U leadpilot_app -d $DST -At -c "begin; select set_config('app.tenant_id','$A',true); select count(*) from leads; rollback;" | grep -E '^[0-9]+$' | head -1)
none=$(docker exec -e PGPASSWORD="$APPPASS" "$C" psql -h localhost -U leadpilot_app -d $DST -At -c "select count(*) from leads")
check "leads visible with tenant in scope = tenant's own leads" "$cnt" "$(q $DST "select count(*) from leads where tenant_id='$A'")"
check "leads visible with NO tenant in scope" "$none" "0"
"${SU[@]}" -c "drop database $DST" >/dev/null
docker exec "$C" rm -f /tmp/drill.dump /tmp/drill.list
[ $fail = 0 ] && echo "DRILL PASSED" || { echo "DRILL FAILED"; exit 1; }
