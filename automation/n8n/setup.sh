#!/usr/bin/env bash
# Instala os workflows do Convexa num n8n que roda em Docker.
# Uso: CONTAINER=convexa-n8n INTERNAL_API_KEY=... AUTOMACAO_KEY=... ./setup.sh
# As chaves viram credenciais do n8n (cifradas pela N8N_ENCRYPTION_KEY) e não ficam em arquivo.
set -euo pipefail
cd "$(dirname "$0")"
: "${CONTAINER:=convexa-n8n}"
: "${INTERNAL_API_KEY:?defina INTERNAL_API_KEY (a mesma da ConvexaAPI)}"
: "${AUTOMACAO_KEY:?defina AUTOMACAO_KEY (a mesma do convexa-automacao)}"

node build-workflows.mjs >/dev/null
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify([
  { id: "cvxInternalKey01", name: "Convexa API (chave interna)", type: "httpHeaderAuth", data: { name: "x-internal-key", value: process.env.INTERNAL_API_KEY } },
  { id: "cvxAutomacaoKey1", name: "Convexa Automação (chave)", type: "httpHeaderAuth", data: { name: "x-automacao-key", value: process.env.AUTOMACAO_KEY } },
]));' "$tmp/credentials.json"

docker exec -u root "$CONTAINER" rm -rf /tmp/convexa && docker exec "$CONTAINER" mkdir -p /tmp/convexa
docker cp "$tmp/credentials.json" "$CONTAINER":/tmp/convexa/credentials.json
docker cp workflows "$CONTAINER":/tmp/convexa/
docker exec "$CONTAINER" n8n import:credentials --input=/tmp/convexa/credentials.json
docker exec "$CONTAINER" n8n import:workflow --separate --input=/tmp/convexa/workflows
for id in cvxEnviarLote001 cvxWhatsappIn001 cvxRelogio000001 cvxAlexa00000001 cvxMercadoPago01; do
  docker exec "$CONTAINER" n8n publish:workflow --id="$id"
done
docker exec -u root "$CONTAINER" rm -rf /tmp/convexa
docker restart "$CONTAINER" >/dev/null
echo "Workflows publicados. O n8n foi reiniciado para registrar os webhooks."
