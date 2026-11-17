#!/usr/bin/env bash
# Instala os workflows "Convexa - 00…17" num n8n que roda em Docker.
#
#   CONTAINER=n8n INTERNAL_API_KEY=... [GROQ_API_KEY=...] [N8N_URL=http://localhost:5678] ./setup.sh
#
# - Credenciais: só são criadas/atualizadas se a variável vier preenchida (os ids são os mesmos do
#   export original, então quem já tem "Convexa - Internal API Key" e "Groq account" não precisa).
# - Publica na ordem certa: o n8n só publica um workflow depois dos subworkflows que ele chama.
# - Cria as tabelas (Data tables) chamando o WF17 pelo webhook protegido pela chave interna.
set -euo pipefail
cd "$(dirname "$0")"
: "${CONTAINER:=n8n}"
: "${N8N_URL:=http://localhost:5678}"

node build.mjs >/dev/null
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

docker exec -u root "$CONTAINER" rm -rf /tmp/convexa-nativo
docker exec "$CONTAINER" mkdir -p /tmp/convexa-nativo
if [ -n "${INTERNAL_API_KEY:-}" ] || [ -n "${GROQ_API_KEY:-}" ]; then
  node -e '
const c = [];
if (process.env.INTERNAL_API_KEY) c.push({ id: "nCSP3kSFDlY3r6RU", name: "Convexa - Internal API Key", type: "httpHeaderAuth", data: { name: "x-internal-key", value: process.env.INTERNAL_API_KEY } });
if (process.env.GROQ_API_KEY) c.push({ id: "XVcRSw0hCQgad0Ii", name: "Groq account", type: "groqApi", data: { apiKey: process.env.GROQ_API_KEY } });
require("fs").writeFileSync(process.argv[1], JSON.stringify(c));' "$tmp/credentials.json"
  docker cp "$tmp/credentials.json" "$CONTAINER":/tmp/convexa-nativo/credentials.json
  docker exec "$CONTAINER" n8n import:credentials --input=/tmp/convexa-nativo/credentials.json
fi
docker cp workflows "$CONTAINER":/tmp/convexa-nativo/
docker exec -u root "$CONTAINER" chown -R node /tmp/convexa-nativo 2>/dev/null || true
docker exec "$CONTAINER" n8n import:workflow --separate --input=/tmp/convexa-nativo/workflows
docker exec -u root "$CONTAINER" rm -rf /tmp/convexa-nativo

# folhas primeiro (14, 15, 16 e os subworkflows), depois quem chama (00, 11, 13)
ORDEM="gwRuN7kMLozuUyEf cvxIntegraMeta15 cvxRegistros0016 tPmuN5i2mwY8whUh fJByu5qfUoLICkhT u5PofWGIegW0fxr1 o5UVBX2a06p0VBGb cyESqJD5y2H5klTX rqqKIPjaeAqEy8GW 3vGOPsRRUJxxJtqm teeIpYOjy1LeRaHT wHl9gupQNIMgqkid P5jQ0lMlJKm3n4Z7 FjGdfMtAM5nAZu4Q cs1xHHp13UwQIpkR FDRYEf2GO7QqaRU1 1iP6wUyAgMECKreB cvxInstalacao017"
for id in $ORDEM; do
  saida=$(docker exec "$CONTAINER" n8n publish:workflow --id="$id" 2>&1 || true)
  case "$saida" in *"Cannot publish"*|*"failed"*|*"rror"*) echo "não publicou $id:"; echo "$saida" | tail -2 ;; esac
done
docker restart "$CONTAINER" >/dev/null
for _ in $(seq 1 90); do curl -sf "$N8N_URL/healthz" >/dev/null && break; sleep 1; done
sleep 5

if [ -n "${INTERNAL_API_KEY:-}" ]; then
  curl -sf -X POST "$N8N_URL/webhook/convexa/instalar" -H "x-internal-key: $INTERNAL_API_KEY" && echo
else
  echo "Sem INTERNAL_API_KEY: abra o workflow 'Convexa - 17 Instalação' no n8n e clique em Execute workflow."
fi
echo "Pronto. Webhook da Meta: $N8N_URL/webhook/convexa/message (GET para verificar, POST para mensagens)."
