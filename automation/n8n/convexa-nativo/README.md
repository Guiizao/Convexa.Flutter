# Convexa — workflows n8n (00 a 17)

Esta pasta completa os workflows que a equipe vinha montando (`Workflows.zip`, de 16/11/2026).
A conversa inteira roda no n8n e usa só as rotas internas da ConvexaAPI (`/internal/*`). O backend
do Gabriel não foi alterado.

- `workflows/` tem os 18 JSONs para importar.
- `logica/` tem o JavaScript de cada node "Lógica", para revisar fora do n8n.
- `build.mjs` gera os JSONs a partir de `logica/`.
- `setup.sh` instala tudo num n8n em Docker.

Os ids e nomes dos workflows 00–14 e das credenciais são os mesmos do export original. Importar
por cima **atualiza** os workflows que já existem no n8n, sem duplicar nada.

> É uma alternativa ao `convexa-automacao` (o serviço em `automation/service`). Os dois não podem
> receber o webhook do mesmo número da Meta ao mesmo tempo: escolha um por número.

## O que mudou em relação ao zip

| No zip | Agora |
|---|---|
| `API Autorizada?` comparava `Authorization` com um token de teste escrito no próprio node. A Meta não manda esse header, então todo evento real seria recusado. | Eventos da Meta têm a assinatura `X-Hub-Signature-256` conferida com o App Secret (vem da API pelo `phoneNumberId`). O formato de teste só é aceito se `CONVEXA_TEST_TOKEN` estiver definido. Nenhum segredo fica escrito em node. |
| `Normaliza Texto` sempre punha `step: "IDLE"`. O Switch nunca saía do fallback. | O estado da conversa fica salvo na tabela `convexa_conversas` (Data table do n8n) e é carregado a cada mensagem. |
| WF07 chegava com `token: null` (`Bearer null`). | O WF10 abre a sessão em **toda** mensagem (o token dura 5 min) e o contexto inteiro, com o token, segue para cada subworkflow. |
| URL da API escrita no node (`https://api-convexa.altvia.cloud`). | Vem de `CONVEXA_API_URL`. Esse endereço continua como padrão. |
| A resposta para a Meta só saía no fim do fluxo. | Responde 200 logo depois de validar (a Meta reenvia se demorar) e processa depois. |
| Sem verificação do webhook (GET `hub.challenge`). | GET no mesmo caminho, conferindo `WHATSAPP_VERIFY_TOKEN`. |
| WF02–WF06, WF08, WF09 e WF11–WF14 eram só o gatilho. | Todos completos (tabela abaixo). |
| IA com memória e instruções para "consultar a API". | A IA só classifica a intenção (JSON). Não chama a API, não vê token nem chave, e tem tempo-limite de 8 s. Sem chave ou fora do ar, o bot segue pelas regras. |

Mais três coisas que o zip não tinha: mensagens repetidas pela Meta são ignoradas (mesmo
`message.id`), a cota é consumida antes de cada envio e erros e alertas vão para o WF14.

## Workflows

| # | Faz | Passos (`conversation.step`) |
|---|---|---|
| 00 Entrada de Mensagem | Webhook `convexa/message` (GET verificação, POST mensagens), assinatura, normalização, estado, WF10, roteamento pelo Switch, salvar, enviar e registrar | — |
| 01 Entendendo a mensagem | Intenção por botão do menu, por regras e (se precisar) pela IA. Depois chama o workflow certo | `IDLE` e passos não mapeados |
| 02 Criando Agendamento | serviço → dia → horário → resumo → `POST /appointments` (com nova busca se der 409) | `WAITING_SERVICE`, `WAITING_DATE`, `WAITING_TIME`, `WAITING_APPOINTMENT_CONFIRMATION` |
| 03 Verificando Disponibilidade | `GET /availability`. Se o dia não tem vaga, procura nos próximos 7 dias | (sub) |
| 04 Reagendando | escolhe → dia → horário → resumo De/Para → `POST /appointments/{id}/reschedule` | `WAITING_RESCHEDULE_DATE`, `_TIME`, `_CONFIRMATION` |
| 05 Cancelando | escolhe → confirma → `POST /appointments/{id}/cancel` | `WAITING_CANCEL_SELECTION`, `WAITING_CANCEL_CONFIRMATION` |
| 06 Informações de Agendamento | "meus horários", detalhes, botões Remarcar e Cancelar | `WAITING_APPOINTMENT_SELECTION` |
| 07 Informações dos Serviços | `GET /services`: tabela de preços ou dados para o WF02 | (sub) |
| 08 Informações do Estabelecimento | endereço, funcionamento, pagamento, contatos (tabela `convexa_empresas`) | (sub) |
| 09 Transferência para Atendente | modo `HUMAN` (o bot fica quieto). Avisa a equipe; "menu" volta ao bot; expira em `CONVEXA_HUMANO_HORAS` | modo `HUMAN` |
| 10 Dados do Cliente | `POST /internal/conversation/session` a cada mensagem. Pede o nome se o WhatsApp não trouxer | `WAITING_CUSTOMER_NAME` |
| 11 Lembrete de Agendamento | a cada 15 min: lembrete com botões (janela de 24 h aberta) ou modelo `convexa_lembrete` (janela fechada). Também sincroniza com o painel (cancelamentos e horários marcados lá) | — |
| 12 Confirmação de Agendamento | resposta ao lembrete: confirmo, remarcar, cancelar | `WAITING_APPOINTMENT_CONFIRMATION_REPLY` |
| 13 Pós-Agendamento | a cada hora: agradece depois do atendimento e oferece agendar de novo | — |
| 14 Tratamento de Erros | `errorWorkflow` de todos e destino dos alertas: grava em `convexa_erros`, não repete o mesmo aviso na mesma hora e avisa num webhook (Slack, Discord etc.) | — |
| 15 Integração Meta (novo) | confere a assinatura e envia pela Graph API (cota → token → envio, uma por vez). **Não salva execuções**, porque o token da Meta passa por ele | (sub) |
| 16 Registros (novo) | eventos → `convexa_agendamentos`; alertas → WF14 | (sub) |
| 17 Instalação (novo) | cria as 5 tabelas (rodar uma vez) | — |

O WF10 roda antes do Switch em toda mensagem. Por isso o passo `WAITING_CUSTOMER_NAME` já sai
resolvido dele, e a saída correspondente do Switch vai para o WF01.

Em qualquer ponto da conversa: "menu", "sair", "voltar" ou um botão do menu recomeçam. Uma
conversa parada no meio por mais de 2 h também recomeça.

## Tabelas (Data tables do n8n)

| Tabela | Para quê |
|---|---|
| `convexa_conversas` | estado de cada conversa (chave `phoneNumberId:+telefone`) |
| `convexa_agendamentos` | agendamentos vistos pelo bot (lembrete, pós-atendimento, sincronização) |
| `convexa_empresas` | **preencher à mão**, uma linha por número da Meta: `phoneNumberId`, `nome`, `endereco`, `mapsUrl`, `horarios`, `pagamento`, `telefone`, `instagram`, `site`, `observacoes`, `telefoneAtendente` |
| `convexa_envios` | log de cada mensagem enviada (sem token) |
| `convexa_erros` | erros e alertas |

## Configuração

### Credenciais no n8n (os mesmos nomes do zip)

- **Convexa - Internal API Key** (Header Auth): nome `x-internal-key`, valor igual ao `INTERNAL_API_KEY` da ConvexaAPI.
- **Groq account** (opcional): chave da Groq. Sem ela, a intenção sai só pelas regras.

### Variáveis de ambiente do n8n

Todas são opcionais: sem elas valem os padrões. Para ler variáveis, o n8n 2 precisa de
`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. Se o acesso continuar bloqueado, os workflows usam os padrões.

| Variável | Padrão | Para quê |
|---|---|---|
| `CONVEXA_API_URL` | `https://api-convexa.altvia.cloud` | ConvexaAPI |
| `WHATSAPP_VERIFY_TOKEN` | — (sem ele a verificação da Meta é recusada) | o mesmo texto que você põe na Meta |
| `GRAPH_API_VERSION` | `v25.0` | a v24.0 expirou em 06/10/2026 |
| `GRAPH_API_BASE` | `https://graph.facebook.com` | trocar só para o simulador |
| `CONVEXA_TEMPLATE_LEMBRETE` | `convexa_lembrete` | modelo aprovado (6 variáveis, 3 botões). Vazio = sem lembrete fora da janela |
| `CONVEXA_TEMPLATE_POS` | — | modelo opcional do pós-atendimento (2 variáveis, 1 botão) |
| `CONVEXA_TEMPLATE_IDIOMA` | `pt_BR` | |
| `CONVEXA_LEMBRETE_HORAS` | `24` | quanto tempo antes lembrar |
| `CONVEXA_HUMANO_HORAS` | `12` | quanto tempo o bot fica quieto após pedir atendente |
| `CONVEXA_ALERTA_WEBHOOK_URL` | — | POST com `{ text, content, tipo, mensagem… }` (serve para Slack e Discord) |
| `CONVEXA_TEST_TOKEN` | — | libera o formato de teste (`Authorization: Bearer <token>`) |
| `CONVEXA_EXIGIR_ASSINATURA` | `true` | `false` aceita webhooks de números sem App Secret no painel (não recomendado) |
| `CONVEXA_IA` | `auto` | `off` desliga a IA |

### Instalar

Com Docker:

```bash
CONTAINER=n8n INTERNAL_API_KEY=... GROQ_API_KEY=... N8N_URL=https://n8n.seudominio ./setup.sh
```

Pela interface (sem Docker):

1. Importe os 18 JSONs de `workflows/`.
2. Publique os workflows nesta ordem: 14, 15, 16, 03, 07, 10, 08, 09, 02, 04, 05, 06, 12, 01, 00, 11, 13. O n8n
   recusa publicar quem chama um subworkflow ainda não publicado, e os subworkflows também precisam
   estar publicados.
3. Abra o **17 Instalação** e clique em *Execute workflow*. A instalação não roda pela linha de comando
   (`n8n execute`), porque nesse modo o n8n desliga as Data tables.

### Meta (WhatsApp Cloud API)

- **URL de callback:** `https://<seu n8n>/webhook/convexa/message`. Use o mesmo texto de `WHATSAPP_VERIFY_TOKEN` e assine o campo `messages`.
- **Token e App Secret:** ficam no painel (integração da empresa) e o n8n busca na API pelo `phoneNumberId`. Sem App Secret, os webhooks são recusados e o WF14 avisa.
- **Modelo:** aprove o `convexa_lembrete` (texto em `automation/simulator/templates.json`; dá para criar com `node automation/scripts/meta-preparar.mjs criar-modelos`).

## Testar

- Bateria ponta a ponta com o simulador: `automation/scripts/bateria-nativo.mjs`, com 21 cenários e 72 verificações. Cobre agendar, consultar, remarcar, cancelar, informações, atendente, robustez, segurança, lembrete, pós-atendimento e cota.
- Formato de teste (Postman/curl), com `CONVEXA_TEST_TOKEN` definido:

```bash
curl -X POST https://<n8n>/webhook/convexa/message -H "Authorization: Bearer $CONVEXA_TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumberId":"<id da Meta>","customer":{"phone":"5514999999999","name":"Ana"},"message":{"text":"quero agendar amanhã às 15h"}}'
```

A resposta traz as mensagens que o bot mandaria, o passo da conversa e os eventos. Só envia de
verdade pela Meta com `"enviar": true`.

- Rodar agora: lembretes `POST /webhook/convexa/lembretes` e pós-atendimento `POST /webhook/convexa/pos-atendimento`, os dois com o header `x-internal-key`.

## Limites conhecidos

- **Horários:** a rota de conversa devolve no máximo 10 horários livres por dia, sempre os primeiros
  (sem filtro "a partir de"). Se o cliente pede um horário mais tarde que não apareceu, o bot tenta
  reservar na confirmação, profissional por profissional, e a API decide. Sugestão ao Gabriel:
  aceitar `from=HH:MM` em `GET /internal/conversation/availability`.
- **Lembretes:** a API só lista agendamentos por cliente (token da conversa). Por isso o WF11
  verifica cliente a cliente: quem tem horário próximo e quem conversou nos últimos 30 dias, até 30
  por rodada. Quem marcou pelo painel e nunca falou com o bot não recebe lembrete. Sugestão: uma rota
  interna `GET /internal/appointments/upcoming?phoneNumberId=`.
- **Confirmação de presença:** a rota de conversa não tem "confirmar". A confirmação fica registrada em
  `convexa_agendamentos.confirmado` e não muda o status na agenda.
- **Atendente:** com a Cloud API, a equipe não responde pelo mesmo número (a não ser com
  *coexistence*). O aviso leva o link `wa.me` do cliente e vai para `CONVEXA_ALERTA_WEBHOOK_URL`, e
  para o WhatsApp do `telefoneAtendente`, que só chega se esse número falou com a empresa nas
  últimas 24 h.
- **Usernames da Meta (2026):** mensagem que chega sem telefone (só o id do usuário) é ignorada,
  porque a agenda identifica o cliente pelo telefone.
- **API fora do ar:** sem a API não dá para conferir a assinatura nem pegar o token de envio. O
  webhook responde 401, a Meta reenvia sozinha e o WF14 avisa.
