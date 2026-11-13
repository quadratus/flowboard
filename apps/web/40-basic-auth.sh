#!/bin/sh
# Turns on HTTP basic auth when both variables are set. Local Docker sets neither, so the
# barrier stays off. The nginx image runs this file at start (/docker-entrypoint.d).
set -eu

conf=/etc/nginx/conf.d/default.conf
user="${BASIC_AUTH_USER:-}"
pass="${BASIC_AUTH_PASSWORD:-}"

if [ -z "$user" ] && [ -z "$pass" ]; then
  echo "basic-auth: off (BASIC_AUTH_USER and BASIC_AUTH_PASSWORD are not set)"
  exit 0
fi
# One variable without the other is a configuration error. Stop, so the site never starts open.
if [ -z "$user" ] || [ -z "$pass" ]; then
  echo "basic-auth: set both BASIC_AUTH_USER and BASIC_AUTH_PASSWORD, or neither" >&2
  exit 1
fi
case "$user" in *:*)
  echo "basic-auth: BASIC_AUTH_USER must not contain ':'" >&2
  exit 1
  ;;
esac

# SHA-512 crypt hash from busybox. The plain password never goes to disk.
printf '%s:%s\n' "$user" "$(printf '%s' "$pass" | mkpasswd -m sha512 -P 0)" > /etc/nginx/htpasswd
chmod 640 /etc/nginx/htpasswd
chown root:nginx /etc/nginx/htpasswd
# Change only the server-level line; /healthz keeps its own "auth_basic off".
sed -i 's|^  auth_basic off;|  auth_basic "Flowboard";|' "$conf"
echo "basic-auth: on for user '$user'"
