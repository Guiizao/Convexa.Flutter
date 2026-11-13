#!/usr/bin/env bash
# Gera o painel web (Flutter) apontando para os endereços de produção e copia para ./painel.
# Uso: DOMAIN=seudominio.com.br ./build-painel.sh   (rode numa máquina com Flutter instalado)
set -euo pipefail
cd "$(dirname "$0")"
: "${DOMAIN:?defina DOMAIN, ex.: DOMAIN=seudominio.com.br ./build-painel.sh}"
ROOT=$(cd ../.. && pwd)
(cd "$ROOT" && flutter build web --release --no-web-resources-cdn \
  --dart-define=API_BASE_URL="https://api.${DOMAIN}" \
  --dart-define=AUTOMACAO_URL="https://auto.${DOMAIN}" \
  --dart-define=WHATSAPP_WEBHOOK_URL="https://n8n.${DOMAIN}/webhook/whatsapp")
mkdir -p painel
find painel -mindepth 1 -delete
cp -r "$ROOT/build/web/." painel/
echo "Painel pronto em deploy/painel (servido pelo Caddy em https://painel.${DOMAIN})."
