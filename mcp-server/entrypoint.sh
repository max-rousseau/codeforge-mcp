#!/bin/bash
set -e

node /app/docker-proxy.cjs &

until [ -S /var/run/codeforge.sock ]; do
  sleep 0.1
done

exec su -s /bin/bash node -c "exec node /app/dist/index.js"
