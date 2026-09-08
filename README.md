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
`lib/api/repositories.dart`. Autenticação por `Authorization: Bearer <token>`;
o `businessId` é derivado do token no servidor — o painel **não** envia
`x-business-id`.

| Método | Rota | Para quê |
|---|---|---|
| POST | `/api/auth/login` | `{email, password}` → `{token, user, business}` |
| POST | `/api/auth/register` | `{business:{name,slug}, owner:{name,email,password}}` |
| GET | `/api/auth/me` | revalida o token guardado |
| GET | `/api/services` | catálogo de serviços |
| POST/PATCH/DELETE | `/api/services[/:id]` | CRUD de serviços |
| GET | `/api/appointments?date=` | agenda do dia |
| GET | `/api/appointments?from=&to=` | dias com agendamento no mês |
| PATCH | `/api/appointments/:id` | `{status}` |
| GET | `/api/appointments/availability?date=&serviceId=` | horários livres |
| GET/PUT | `/api/business-hours` | janela de atendimento do dia |
| POST | `/api/shift/open` | abre o expediente e dispara o aviso de abertura |
| POST | `/api/shift/close` | encerra o dia e programa o dia seguinte |
| GET | `/api/metrics?month=&compareTo=` | KPIs, receita por semana, serviços |
| GET/PUT | `/api/settings` | regras do agente (ver abaixo) |

Rotas que ainda não existirem no backend fazem o painel cair no estado vazio —
ele nunca inventa dado para preencher a tela.

### Flags que a automação (n8n) consome

`GET /api/settings` devolve o objeto que decide o comportamento do bot:

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
- O token de sessão vive em memória. Persistir "continuar conectado" entre
  recarregamentos ainda está pendente — ver o comentário em
  `lib/ui/screens/login_screen.dart`.
- `web/robots.txt` bloqueia indexação: é um painel logado, não deve aparecer
  em busca.

---

## Testes

```bash
flutter analyze
flutter test
```
