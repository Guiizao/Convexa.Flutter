#!/usr/bin/env bash
# Cria o .env a partir do .env.example, preenchendo os segredos que estiverem vazios.
# Pode rodar de novo: segredo já preenchido não muda (trocar chave de cifra estraga dados gravados).
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
r() { openssl rand -base64 32 | tr -d '\n'; }
u() { openssl rand -base64 64 | tr -d '\n/+=' | cut -c1-48; }
fill() {
  local key=$1 value=$2
  if grep -q "^${key}=$" .env; then
    sed -i "s|^${key}=$|${key}=${value}|" .env
    echo "gerado: ${key}"
  fi
}
fill POSTGRES_PASSWORD "$(u)"
fill JWT_SECRET "$(u)"
fill INTERNAL_API_KEY "$(u)"
fill CREDENTIALS_ENCRYPTION_KEY "$(r)"
fill AUTOMACAO_KEY "$(u)"
fill ENCRYPTION_KEY "$(r)"
fill N8N_ENCRYPTION_KEY "$(u)"
fill WHATSAPP_VERIFY_TOKEN "$(u | cut -c1-24)"
chmod 600 .env
echo "Pronto. Agora edite o .env e preencha DOMAIN, ACME_EMAIL, RESEND_API_KEY e o que mais for usar."
