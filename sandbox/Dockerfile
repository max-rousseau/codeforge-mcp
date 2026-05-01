FROM denoland/deno:2.3.1

RUN apt-get update && \
    apt-get install -y ca-certificates curl iproute2 && \
    rm -rf /var/lib/apt/lists/*

COPY sandbox/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
COPY LICENSE.md /LICENSE.md

RUN mkdir -p /skills && chown deno:deno /skills

ENV DENO_CERT=/certs/mitmproxy-ca-cert.pem

WORKDIR /home/deno

ENTRYPOINT ["/entrypoint.sh"]
CMD ["sleep", "infinity"]
