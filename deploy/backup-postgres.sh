#!/bin/sh
set -eu

umask 077
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file=${ENV_FILE:-"$project_dir/.env.production"}
backup_dir=${BACKUP_DIR:-"$project_dir/backups/postgres"}
retention_days=${BACKUP_RETENTION_DAYS:-14}

case "$retention_days" in
  ''|*[!0-9]*) echo 'BACKUP_RETENTION_DAYS must be a non-negative integer' >&2; exit 1 ;;
esac
test -f "$env_file" || { echo 'Production environment file is missing' >&2; exit 1; }

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backup_dir/zastore-$timestamp.dump"
partial="$backup_dir/.zastore-$timestamp.partial"
trap 'rm -f "$partial"' EXIT HUP INT TERM

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
  exec pg_dump -h 127.0.0.1 -U "$user" -d "$database" \
    --format=custom --compress=9 --no-owner --no-privileges
' > "$partial"

test -s "$partial" || { echo 'Backup is empty' >&2; exit 1; }
mv "$partial" "$target"
chmod 600 "$target"
find "$backup_dir" -type f -name 'zastore-*.dump' -mtime "+$retention_days" -delete
trap - EXIT HUP INT TERM
printf '%s\n' "$target"
