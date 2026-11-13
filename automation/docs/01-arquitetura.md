# Convexa: arquitetura da automação

Este documento é o plano. Foi escrito antes do código e diz o que cada peça
faz, onde ela roda e por quê.

## O produto em uma frase

Um estabelecimento de serviço (barbearia, salão, clínica, estúdio, pet shop,
qualquer negócio que vende horário) recebe agendamentos pelo WhatsApp sem
ninguém responder à mão. O dono acompanha tudo no painel, conversa com o
mesmo bot para administrar o dia e, se quiser, pergunta para a Alexa.

## As peças

```
                      ┌──────────────────────────────┐
  Cliente ──WhatsApp──▶                              │
  Dono ────WhatsApp──▶   Meta WhatsApp Cloud API    │
                      └──────────────┬───────────────┘
                                     │ webhook
                                     ▼
  Alexa ─────────────────────▶ ┌───────────┐ ◀──── Mercado Pago (webhook Pix)
                               │    n8n    │ ◀──── cron (lembretes, sinal, agenda Google)
                               └─────┬─────┘
                                     │ HTTP interno
                                     ▼
  Painel (Flutter Web) ──────▶ ┌──────────────────┐ ──────▶ Google Agenda
                               │ convexa-automacao│
                               └────────┬─────────┘
                                        │ HTTP (x-internal-key / sessão do dono)
                                        ▼
  Painel (Flutter Web) ──────▶ ┌──────────────────┐
                               │   ConvexaAPI     │  (backend do Gabriel, não alterado)
                               └──────────────────┘
```

| Peça | O que faz | O que **não** faz |
|---|---|---|
| **ConvexaAPI** (Gabriel) | Dona da agenda: serviços, profissionais, jornada, folgas, bloqueios, clientes, agendamentos, conflitos, preço congelado, credenciais da Meta, cota de mensagens. | Não sabe nada de conversa, sinal, Pix, Google ou Alexa. |
| **n8n** | Canais e relógio. Recebe o webhook do WhatsApp, baixa mídia, consome a cota, envia mensagens pela Meta. Recebe a Alexa e o webhook do Mercado Pago. Dispara os jobs agendados. | Não decide o que responder. |
| **convexa-automacao** | O cérebro da conversa. Entende a mensagem, guarda o estado de cada conversa, decide a resposta (texto, botões, lista), executa na ConvexaAPI, gera Pix, controla sinal, roda os comandos do dono, sincroniza com o Google Agenda, responde a Alexa. Guarda as configurações do bot. | Não fala com a Meta diretamente e não guarda agenda. |
| **Painel** (Flutter Web) | Tudo que o dono vê e configura: agenda, serviços, expediente, resultados e, agora, a tela de Automação (bot, número do dono, sinal/Pix, Google, Alexa, comprovantes pendentes, conversas). | — |

### Por que um serviço separado e não tudo dentro do n8n

Uma conversa de agendamento tem dezenas de estados (escolhendo serviço, dia,
horário, profissional, confirmando, pagando, remarcando...). Montado em nós
visuais do n8n isso vira um diagrama que ninguém consegue manter nem testar.
No serviço, cada fluxo é código com teste automatizado. O n8n continua sendo
o orquestrador: todo canal de entrada e saída, toda chamada à Meta e todo
agendamento de tarefa passa por ele, e o fluxo fica visível na tela do n8n.

### Por que a ConvexaAPI não foi alterada

Pedido do time. Tudo que falta no backend para a automação (configurações do
bot, sinal, vínculo com Google e Alexa) fica num banco próprio da automação.
O que seria melhor resolvido no backend está em `04-proposta-backend.md`,
como sugestão para o Gabriel, sem nada aplicado.

## Como a automação conversa com a ConvexaAPI

**Do lado do cliente**, exatamente o fluxo que o Gabriel desenhou: a cada
mensagem abre `POST /internal/conversation/session` e usa as rotas
`/internal/conversation/*` com o token da conversa. Esse token só enxerga o
próprio cliente, então o bot não tem como mexer na agenda de outra pessoa.

**Para agir em nome de um cliente que não escreveu** (o dono pediu para
remarcar quem estava às 14h), a automação abre uma sessão de conversa com o
telefone daquele cliente. Continua isolado por cliente.

**Do lado do dono** (agenda do dia inteiro, faturamento, bloqueio de horário,
confirmar pagamento), a ConvexaAPI não tem rota interna. A automação usa as
rotas do painel com uma sessão do próprio dono:

- O dono conecta a automação uma vez no painel, digitando a senha de novo.
- A automação guarda e-mail e senha **cifrados** (AES-256-GCM) e faz login
  quando precisa. O access token (15 min) fica em memória.
- **Não usa refresh token de propósito.** A API tem detecção de reuso: se um
  refresh token já trocado for apresentado de novo (por exemplo, depois de um
  timeout de rede), ela derruba **todas** as sessões do dono, inclusive a do
  painel aberto. Login direto não tem esse risco.
- Limite conhecido: `/api/auth/*` aceita 20 requisições a cada 15 minutos por
  IP. Com um login a cada 15 minutos por estabelecimento ativo, isso comporta
  o piloto (até ~15 estabelecimentos). Para escalar, ver a proposta ao
  backend.

## Decisões

### WhatsApp: API oficial da Meta (Cloud API)

- O backend já foi desenhado para ela (`metaPhoneNumberId`, credenciais
  cifradas, cota mensal).
- Botões e listas só funcionam de forma confiável na API oficial. APIs não
  oficiais (Evolution, Baileys) perderam os botões e arriscam o número ser
  banido.
- **Regra das 24 horas:** responder o cliente dentro de 24h da última
  mensagem dele é livre. Fora dessa janela (lembrete de amanhã, aviso de
  remarcação) a Meta só aceita **template aprovado**. Os templates estão em
  `03-configuracao.md` e precisam ser enviados para aprovação.

### Pix e sinal

Dois modos, configuráveis por estabelecimento:

| Modo | Como funciona | Confirmação |
|---|---|---|
| **Pix automático** (Mercado Pago) | A automação cria a cobrança, manda o copia e cola e o QR. | Automática, pelo webhook do Mercado Pago. É o único modo em que o pagamento é de fato verificado. |
| **Pix da chave do dono** | A automação gera o copia e cola (BR Code com valor e identificador) a partir da chave Pix do dono. | O cliente manda a foto do comprovante. O dono recebe a foto com botões **Aprovar / Recusar**. |

Foto de comprovante não prova pagamento: é fácil de editar. Por isso, no modo
manual, quem aprova é o dono (no WhatsApp ou no painel). Se uma chave de IA
estiver configurada, a automação lê o comprovante antes (valor, data,
recebedor) e avisa o dono quando algo não bate, mas a decisão continua dele.

Desconto para pagamento antecipado: configurável em %. O preço do
agendamento continua o da ConvexaAPI; o desconto e o valor pago ficam
registrados na automação.

### Linguagem natural

Camada 1, sempre ligada: botões e listas (a maior parte da conversa) e um
interpretador de português feito à mão para datas ("amanhã", "sexta",
"dia 15", "15/11"), horários ("14h", "meio-dia", "de tarde"), serviços e
comandos do dono. Funciona sem internet e sem custo, e é testado.

Camada 2, opcional: com uma chave da API do Claude (Anthropic), o que a
camada 1 não entender vai para o modelo, que devolve a intenção em formato
estruturado. A decisão e a execução continuam no código, nunca no modelo.

### Google Agenda

Por estabelecimento: o dono clica em **Conectar Google Agenda** no painel e
autoriza. A automação cria, move e apaga eventos conforme os agendamentos, e
os compromissos pessoais do dono no Google viram bloqueio na Convexa (opção).

### Alexa

Skill personalizada em português, só para o dono. O dono gera um código de 6
dígitos no painel e fala "Alexa, abrir minha agenda e vincular código 123456".
Dali em diante ele consulta agenda, horários livres, faturamento e próximo
cliente, bloqueia horário e manda aviso para os clientes por voz.

## Onde cada coisa roda (hospedagem)

| Peça | Recomendado | Por quê |
|---|---|---|
| ConvexaAPI | Onde já está (`api-convexa.altvia.cloud`) | Não mexer. |
| n8n + convexa-automacao + Postgres da automação | **No mesmo servidor da API**, num `docker compose` | Precisam ficar ligados 24h e ter URL pública HTTPS para os webhooks da Meta, Alexa e Mercado Pago. Vercel e Cloudflare Workers são serverless e não servem para o n8n. |
| Painel | **Site web** (Flutter Web) em Vercel, Cloudflare Pages ou Netlify | Abre no PC e no celular sem instalar nada, atualiza para todo mundo de uma vez e pode ser instalado como app (PWA). Um app local na rede só funcionaria dentro do estabelecimento. |

O `docker compose` de produção está em `automation/docker/`.

## O que a automação guarda (banco próprio)

| Tabela | Para quê |
|---|---|
| `business_link` | Vínculo da automação com a empresa: número da Meta, credencial do dono cifrada, status. |
| `bot_settings` | Tudo que o dono configura: bot ligado, números do dono, segmento e vocabulário, lembretes, sinal/Pix, desconto, política de cancelamento, Google, Alexa. |
| `conversation` | Estado de cada conversa (em que passo está, o que já escolheu) e o horário da última mensagem (para a regra das 24h). |
| `message_log` | Histórico das mensagens, para o painel e para depurar. |
| `payment` | Sinais e pagamentos: valor, desconto, status, Pix gerado, comprovante, aprovação. |
| `campaign`, `campaign_target` | Rodadas de remarcação e avisos que o dono pediu, cliente por cliente. |
| `reminder_sent` | Garante que cada lembrete sai uma vez só. |
| `google_link`, `calendar_event` | Conta Google conectada e evento de cada agendamento. |
| `alexa_link` | Dispositivo Alexa vinculado a qual empresa. |

## Testes

- Testes automatizados do serviço: interpretador de português, cada fluxo de
  conversa, Pix, comandos do dono, Alexa.
- Ambiente completo em Docker: ConvexaAPI real (código do Gabriel sem
  alteração), Postgres, n8n com os workflows importados, a automação e um
  **simulador de WhatsApp** que imita a API da Meta e mostra botões e listas
  numa tela de chat.
- Conversas roteirizadas de ponta a ponta rodando contra esse ambiente.
- Painel testado em 15 resoluções (celulares, tablets, notebooks e
  monitores), com captura de qualquer estouro de layout que o Flutter acuse.
