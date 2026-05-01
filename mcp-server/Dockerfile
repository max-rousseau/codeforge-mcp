FROM node:22.22.2-slim

WORKDIR /app

COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci

COPY mcp-server/ ./
RUN npm run build

COPY apis/ /apis/
COPY llm-instructions.yaml /llm-instructions.yaml
COPY LICENSE.md /LICENSE.md

RUN chmod +x /app/entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
