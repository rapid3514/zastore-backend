#!/bin/sh
set -eu
# One canonical connection URL also initializes the local PostgreSQL service.
# URL credentials must use unreserved characters; generate passwords as base64url.
case "$DATABASE_URL" in postgresql://*) ;; *) exit 1 ;; esac
connection=${DATABASE_URL#postgresql://}
credentials=${connection%%@*}
location=${connection#*@}
POSTGRES_USER=${credentials%%:*}
POSTGRES_PASSWORD=${credentials#*:}
database=${location#*/}
POSTGRES_DB=${database%%\?*}
case "$POSTGRES_USER" in ''|*[!A-Za-z0-9_-]*) exit 1 ;; esac
case "$POSTGRES_PASSWORD" in ''|*[!A-Za-z0-9_-]*) exit 1 ;; esac
case "$POSTGRES_DB" in ''|*[!A-Za-z0-9_]*) exit 1 ;; esac
export POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
unset DATABASE_URL credentials connection location database
exec /usr/local/bin/docker-entrypoint.sh postgres
