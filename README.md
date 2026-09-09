# Convexa — Painel do estabelecimento

Painel administrativo em **Flutter Web**, responsivo para desktop e celular a
partir de uma única base de código. O dono do estabelecimento acompanha por aqui
a agenda que o agente de IA preenche pelo WhatsApp.

---

## Rodar

```bash
flutter pub get
flutter run -d chrome
```

Por padrão o app aponta para a API publicada (`https://api-convexa.altvia.cloud`).
Para apontar para outro ambiente:

```bash
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:3000
```

Build de produção:

```bash
flutter build web --release --dart-define=API_BASE_URL=https://api-convexa.altvia.cloud
```

Sem credenciais? A tela de login tem **Explorar em modo demonstração**, que
roda o painel inteiro com dados de exemplo e não toca na API.

---

## Estrutura

```
lib/
  api/          ApiClient (JWT, erros) + repositórios por domínio
  core/         datas, formatação de moeda/duração, breakpoints
  models/       Session, ServiceItem, Appointment, WorkShift, AgentSettings…
  state/        AppState (ChangeNotifier) exposto via AppScope
  theme/        tokens de cor/tipografia/espaçamento + ThemeData
  ui/
    brand/      marca e fundo
    components/ cartões, botões, campos, gráficos
    screens/    Expediente, Agenda, Serviços, Resultados, Encerrar, Configurações
```

Sem dependência de gerenciador de estado externo: `ChangeNotifier` +
`InheritedNotifier`. As únicas dependências são `http` e `google_fonts`.

---

## Contrato com a API

Todos os pontos de integração estão marcados com comentários `// API:` em
`lib/api/repositories.dart`. A tabela abaixo reflete o **contrato real da API
publicada** (`GabrielFante/ConvexaAPI`, relatório de deploy de 07/09/2026).

Autenticação por `Authorization: Bearer <accessToken>`. O access token dura
**15 minutos**; o painel guarda o `refreshToken` (30 dias) e troca por um
access novo automaticamente ao tomar `401` (`POST /api/auth/refresh`, que
**rotaciona** o refresh token). O `businessId` vem do token — o painel **não**
envia `x-business-id`.

| Método | Rota | Para quê |
|---|---|---|
| GET | `/health` | checagem simples (fora do prefixo `/api`) |
| POST | `/api/auth/register` | `{business:{name,slug,timezone}, owner:{name,email,password}}` → `{accessToken, refreshToken, user, business}` |
| POST | `/api/auth/login` | `{email, password}` → `{accessToken, refreshToken, user, business}` |
| POST | `/api/auth/refresh` | `{refreshToken}` → `{accessToken, refreshToken}` |
| POST | `/api/auth/logout` | `Bearer` + `{refreshToken}` |
| GET | `/api/auth/me` | `{user, business}` — revalida a sessão guardada |
| POST | `/api/auth/forgot-password` · `/reset-password` | **503 no piloto** — recuperação de senha desligada |
| GET · POST | `/api/services` · GET/PATCH/DELETE `/api/services/:id` | catálogo e CRUD de serviços |
| GET | `/api/appointments?from=&to=` | agenda por intervalo ISO-8601 (também `customerId`, `employeeId`, `status`) |
| GET | `/api/appointments/:id` | um agendamento |
| POST | `/api/appointments` | `{customerId, serviceId, employeeId, startAt, notes?}` |
| POST | `/api/appointments/:id/confirm` · `/complete` · `/cancel` | transição de status — uma ação por rota |
| PATCH | `/api/appointments/:id/reschedule` | `{startAt, employeeId?}` |
| GET | `/api/availability?serviceId=&date=&employeeId=&limit=` | `{slots:[{employeeId,startAt,endAt}], totalSlots}` |
| GET | `/api/business` | negócio com `hours`, `closedDays`, `vacations` (sem segredos da Meta) |
| PATCH · DELETE | `/api/business` | editar / remover (perfil `OWNER`) |
| PUT | `/api/business/hours` | `{hours:[{dayOfWeek,opensAt,closesAt}]}` — grade **semanal** |
| GET · POST · DELETE | `/api/business/closed-days[/:id]` | folgas por data |
| GET · POST · DELETE | `/api/business/vacations[/:id]` | férias |
| GET · POST · DELETE | `/api/time-blocks[/:id]` | pausas/bloqueios por intervalo |
| GET · POST | `/api/customers` · POST `/api/customers/resolve` · GET/PATCH/DELETE `/:id` | clientes |
| GET · POST | `/api/employees` · GET/PATCH/DELETE `/:id` · PUT `/:id/services` · PUT `/:id/hours` | profissionais |

**Não existem** no backend: `/api/metrics`, `/api/settings`, `/api/shift/open`,
`/api/shift/close`, `/api/business-hours`, nem um `PATCH /api/appointments/:id`
genérico. O painel cai no estado vazio nesses casos — calcula o mês a partir
dos próprios agendamentos e lê as configs do agente de `/api/business`. Ele
nunca inventa dado para preencher a tela.

> **CORS:** a API publicada hoje só libera a própria origem
> (`https://api-convexa.altvia.cloud`). Para o painel rodar em `localhost` ou
> em domínio próprio, as origens precisam entrar no `CORS_ORIGINS`/`APP_URL`
> do backend — é um pedido ao time de infra (seção 2 / pendência C06 do
> relatório de deploy).

### Configurações do agente que a automação (n8n) consome

O painel lê e grava o que der em `/api/business` (`GET` devolve, `PATCH`
grava). Hoje só `phone` (número do dono) tem campo correspondente; os demais
switches abaixo ainda **não** existem no backend — ver `FUNCIONALIDADES.md`.

| Campo | Efeito no agente |
|---|---|
| `agentEnabled` | liga/desliga o atendimento automático |
| `agentPhone` / `ownerPhone` | número que atende clientes / número do dono |
| `voiceToText` | transcrever áudio antes de interpretar |
| `ownerChatCommands` | aceitar comandos do dono por texto ou áudio |
| `openingBroadcast` | avisar os clientes do dia quando o expediente abre |
| `reminderEnabled` / `reminderMinutesBefore` | lembrete antes do horário |
| `prepaymentEnabled` / `prepaymentDiscountPercent` | pagamento antecipado com desconto |
| `upsellEnabled` / `upsellServiceIds` | sugerir serviço adicional ao fechar |
| `googleCalendarSync` | gravar o agendamento no Google Agenda |
| `voiceAssistantEnabled` | expor consultas para Alexa/Google/Siri |

---

## Fluxo de expediente

O expediente é uma máquina de três estados, não um liga/desliga:

- **Fechado** — configura janela, intervalo entre horários, pausas e quais
  serviços valem para o dia. Só abre com janela válida e ao menos um serviço ativo.
- **Aberto** — mostra a linha do dia com os blocos ocupados e o marcador de agora.
  O agente passa a oferecer os horários.
- **Encerrado** — você confirma quem foi atendido e quem faltou, programa o dia
  seguinte (ou marca folga) e o agente já responde com os horários de amanhã.

Reabrir é possível, e as ações fazem *rollback* na tela se a API recusar.

---

## Segurança

- Nenhuma chave secreta no front-end. Tokens da Meta/WhatsApp, chave de IA e
  credencial do provedor de pagamento ficam apenas no servidor.
- O painel só conversa com a própria API, sempre por HTTPS.
- **Continuar conectado:** com a opção marcada no login, o access e o refresh
  token ficam no `localStorage` (só no Flutter Web) e a sessão é restaurada no
  boot (`AppState.restoreSession`). Desmarcada, a sessão vive só na aba atual.
  Ver `lib/api/session_store.dart`.
- `web/robots.txt` bloqueia indexação: é um painel logado, não deve aparecer
  em busca.

---

## Testes

```bash
flutter analyze
flutter test
```
