#!/bin/bash
set -e

# Generate CA cert if not already present
if [ ! -f /certs/mitmproxy-ca-cert.pem ]; then
  echo "Generating mitmproxy CA certificate..."
  mkdir -p /certs
  mitmdump --set confdir=/certs -k &
  MITM_PID=$!
  sleep 3
  kill $MITM_PID 2>/dev/null || true
  echo "CA certificate generated at /certs/mitmproxy-ca-cert.pem"
fi

# Redirect incoming traffic on 80/443 to mitmproxy (transparent mode)
iptables -t nat -A PREROUTING -p tcp --dport 80  -j REDIRECT --to-port 8080
iptables -t nat -A PREROUTING -p tcp --dport 443 -j REDIRECT --to-port 8080

# Masquerade outbound traffic from sandbox to external APIs
iptables -t nat -A POSTROUTING -s 10.77.0.0/24 -j MASQUERADE

# Drop to unprivileged user for mitmproxy
chown -R mitmproxy:mitmproxy /certs

exec su -s /bin/bash mitmproxy -c "mitmdump \
  --mode transparent \
  --showhost \
  --set confdir=/certs \
  --set flow_detail=0 \
  -p 8080 \
  -s /addons/substitute.py"
