FROM python:3.12-slim

ARG MITMPROXY_VERSION=11.1.3

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      iptables \
      curl ca-certificates && \
    pip install --no-cache-dir mitmproxy==${MITMPROXY_VERSION} && \
    rm -rf /var/lib/apt/lists/*

RUN useradd --system --no-create-home mitmproxy

COPY proxy/entrypoint.sh /entrypoint.sh
COPY proxy/addons/ /addons/
COPY apis/ /apis/
COPY LICENSE.md /LICENSE.md

RUN chmod +x /entrypoint.sh

EXPOSE 8080 8081

ENTRYPOINT ["/entrypoint.sh"]
