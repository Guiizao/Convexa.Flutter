# Automação do Convexa

Bot do WhatsApp (cliente e dono), sinal por Pix, comprovantes, Google Agenda, Alexa e a API que o
painel usa na aba Automação. Roda ao lado da ConvexaAPI do Gabriel, sem alterá-la.

| Pasta | O que tem |
|---|---|
| `docs/01-arquitetura.md` | O plano: peças, decisões, tabelas, segurança |
| `docs/02-dialogos.md` | Tudo o que o bot entende e responde (cliente, dono, Alexa) e os modelos da Meta |
| `docs/03-configuracao.md` | **Guia para colocar no ar**, passo a passo |
| `docs/04-proposta-backend.md` | Sugestões para a ConvexaAPI (não aplicadas) |
| `service/` | `convexa-automacao` (Node 22 + TypeScript + Express + Postgres) |
| `n8n/` | Workflows (gerados por `build-workflows.mjs`) e `setup.sh` para instalar |
| `deploy/` | Produção: `docker-compose.yml`, Caddy (HTTPS), `.env.example`, scripts |
| `simulator/` | WhatsApp de mentira, compatível com a Graph API, para testar sem a Meta |
| `alexa/` | Pacote da skill ("agenda convexa"): manifesto e modelo de voz pt-BR |
| `scripts/` | `e2e.mjs` (teste ponta a ponta), `layout-sweep.mjs` (painel em 16 resoluções), `seed-demo.mjs`, `cadastrar-empresa.mjs`, `talk.mjs` |

## Rodar localmente (com o simulador, sem Meta)

Pré-requisitos: Node 22, PostgreSQL 16 e Docker (só para o n8n).

```bash
# 1) Bancos
createdb convexa; createdb convexa_automacao; createdb n8n

# 2) ConvexaAPI (no repositório do Gabriel), na porta 3000
#    .env com DATABASE_URL, JWT_SECRET, INTERNAL_API_KEY, CREDENTIALS_ENCRYPTION_KEY, MAIL_DRIVER=console
npm ci && npm run build && npm run migrate:deploy && npm start

# 3) Empresa de demonstração (Barbearia Navalha, número da Meta 100000000000001)
node automation/scripts/seed-demo.mjs          # painel: dono@navalha.demo / Navalha#2026demo

# 4) Serviço de automação, na porta 3100
cd automation/service && npm ci
export DATABASE_URL=postgresql://…/convexa_automacao CONVEXA_API_URL=http://127.0.0.1:3000 \
  INTERNAL_API_KEY=<a mesma da API> AUTOMACAO_KEY=<32+ caracteres> \
  ENCRYPTION_KEY=$(openssl rand -base64 32) PUBLIC_URL=http://localhost:3100 \
  N8N_SEND_WEBHOOK_URL=http://127.0.0.1:5678/webhook/convexa-enviar \
  CORS_ORIGINS=http://localhost:8090 ALEXA_VERIFY_SIGNATURE=false
npm run migrate && npm run dev

# 5) Simulador de WhatsApp, na porta 3200 (abra http://localhost:3200 para conversar)
node automation/simulator/server.mjs

# 6) n8n apontando para o simulador no lugar da Meta
docker run -d --name convexa-n8n --network host \
  -e N8N_LISTEN_ADDRESS=0.0.0.0 -e N8N_RUNNERS_BROKER_LISTEN_ADDRESS=127.0.0.1 \
  -e N8N_ENCRYPTION_KEY=<aleatória> -e N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
  -e DB_TYPE=postgresdb -e DB_POSTGRESDB_HOST=127.0.0.1 -e DB_POSTGRESDB_DATABASE=n8n \
  -e DB_POSTGRESDB_USER=… -e DB_POSTGRESDB_PASSWORD=… \
  -e CONVEXA_API_URL=http://127.0.0.1:3000 -e AUTOMACAO_URL=http://127.0.0.1:3100 \
  -e GRAPH_API_BASE=http://127.0.0.1:3200/graph -e GRAPH_API_VERSION=v21.0 \
  -e WHATSAPP_VERIFY_TOKEN=<qualquer> -e GENERIC_TIMEZONE=America/Sao_Paulo \
  n8nio/n8n:2.47.5
INTERNAL_API_KEY=… AUTOMACAO_KEY=… CONTAINER=convexa-n8n automation/n8n/setup.sh

# 7) Painel apontando para tudo isso
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:3000 \
  --dart-define=AUTOMACAO_URL=http://localhost:3100
```

O simulador assina os webhooks com `simulador-app-secret`. A empresa de demonstração já vem com
esse App Secret, então a verificação de assinatura funciona igual à da Meta.

## Testes

```bash
cd automation/service && npm test        # 109 testes (o de Google Agenda precisa de DATABASE_URL e ENCRYPTION_KEY)
cd automation/scripts && node e2e.mjs    # 24 verificações: simulador → n8n → serviço → API → n8n → simulador
flutter test                             # painel: 26 testes
node automation/scripts/layout-sweep.mjs http://localhost:8090 ./saida   # build web em modo debug
```

O `e2e.mjs` cobre: agendamento por texto livre, sinal por Pix com QR Code, comprovante aprovado
pelo dono, agenda, horários livres e faturamento do dono, bloqueio com pedido de remarcação (o
cliente remarca), consulta e cancelamento pelo cliente e atendimento humano com o bot pausado e
reativado.

## Em produção

Veja `docs/03-configuracao.md`. Em resumo: um VPS com Docker,
`deploy/gerar-segredos.sh`, `docker compose up -d --build`, `n8n/setup.sh`, o número da
Meta colado no painel e os 7 modelos de mensagem aprovados.
