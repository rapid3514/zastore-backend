#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file=${ENV_FILE:-"$project_dir/.env.production"}
backup_file=${1:-}

test "${RESTORE_CONFIRMED:-}" = 'yes' || {
  echo 'Set RESTORE_CONFIRMED=yes only after stopping the backend and taking a fresh backup.' >&2
  exit 1
}
test -f "$env_file" || { echo 'Production environment file is missing' >&2; exit 1; }
test -n "$backup_file" && test -f "$backup_file" || { echo 'Usage: restore-postgres.sh BACKUP.dump' >&2; exit 1; }

cd "$project_dir"
docker compose --env-file "$env_file" exec -T postgres sh -ec '
  connection=${DATABASE_URL#postgresql://}
  credentials=${connection%%@*}
  location=${connection#*@}
  user=${credentials%%:*}
  password=${credentials#*:}
  database=${location#*/}
  database=${database%%\?*}
  export PGPASSWORD=$password
  exec pg_restore -h 127.0.0.1 -U "$user" -d "$database" \
    --clean --if-exists --no-owner --no-privileges --exit-on-error
' < "$backup_file"
