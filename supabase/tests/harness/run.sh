#!/usr/bin/env bash
# Executes the production migrations against a real PostgreSQL instance.
#   fresh   : 001 -> latest on an empty database
#   upgrade : 001 -> 023, load pre-024 fixtures, then apply 024 (twice)
# Requires PGHOST/PGPORT/PGUSER to point at a disposable server.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PSQL="psql -q -v ON_ERROR_STOP=1"

reset_db () {
  psql -qc "drop database if exists $1;" >/dev/null
  psql -qc "create database $1;" >/dev/null
  $PSQL -d "$1" -f "$HERE/bootstrap.sql" >/dev/null
}

apply_upto () { # db, max version
  for f in "$ROOT"/supabase/migrations/0*.sql; do
    n=$(basename "$f" | cut -c1-3)
    [ "$n" -gt "$2" ] && continue
    $PSQL -d "$1" -f "$f" >/dev/null
  done
}

case "${1:-fresh}" in
  fresh)
    reset_db migtest_fresh
    apply_upto migtest_fresh 999
    echo "FRESH_OK"
    ;;
  upgrade)
    reset_db migtest_upgrade
    apply_upto migtest_upgrade 023
    $PSQL -d migtest_upgrade -f "$HERE/legacy_fixtures.sql" >/dev/null
    $PSQL -d migtest_upgrade -f "$ROOT/supabase/migrations/024_product_completion.sql" >/dev/null
    # rerun proves the migration is safe to apply twice
    $PSQL -d migtest_upgrade -f "$ROOT/supabase/migrations/024_product_completion.sql" >/dev/null
    psql -tAF'|' -d migtest_upgrade -c \
      "select jalali_month, net_pay, status from public.payroll_entries order by jalali_month;"
    psql -tAF'|' -d migtest_upgrade -c \
      "select i.invoice_number, coalesce(i.opening_paid_amount::text,'NULL'), v.derived_payment_status
         from public.purchase_invoices i
         left join public.purchase_invoice_balances v on v.id = i.id
        order by i.invoice_number;"
    ;;
esac
