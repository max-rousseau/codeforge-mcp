#!/bin/bash
set -e

# Install mitmproxy CA cert from shared volume into system trust store
echo "Installing proxy CA certificate..."
until [ -f /certs/mitmproxy-ca-cert.pem ]; do
  echo "Waiting for proxy CA cert..."
  sleep 1
done

if [ "$(id -u)" = "0" ]; then
  cp /certs/mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/mitmproxy.crt
  update-ca-certificates

  # Reroute default gateway to proxy container (infrastructure-level enforcement)
  ip route del default 2>/dev/null || true
  ip route add default via 10.77.0.2
fi

exec su -s /bin/bash deno -c "$*"
