#!/bin/sh
set -eu

SECRETS_FILE=/run/iii3xnz/secrets.env
mkdir -p /run/iii3xnz
if [ ! -s "$SECRETS_FILE" ]; then
  umask 077
  {
    printf 'JWT_SECRET=%s\n' "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    printf 'ENCRYPTION_KEY=%s\n' "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  } > "$SECRETS_FILE"
fi
. "$SECRETS_FILE"
export JWT_SECRET ENCRYPTION_KEY
exec "$@"
