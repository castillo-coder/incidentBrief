#!/bin/sh
set -eu
node apps/api/dist/cli/migrate.js
exec "$@"
