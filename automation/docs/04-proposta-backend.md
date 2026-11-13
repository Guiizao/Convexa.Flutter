# Sugestões para a ConvexaAPI (para o Gabriel avaliar)

Nada aqui foi alterado no backend. A automação funciona com a API como ela está hoje. Esta lista
reúne o que deixaria a integração mais simples ou mais robusta, em ordem de impacto. Cada item
diz o que a automação faz hoje para contornar a situação.

## 1. Token de serviço por empresa (no lugar da senha do dono)

**Hoje:** para ver a agenda inteira, bloquear horários, confirmar pagamentos e calcular o
faturamento, a automação entra como o dono, com `POST /api/auth/login`. O dono confirma a senha
uma vez no painel, e ela fica cifrada (AES-256-GCM) no banco da automação. A automação não usa o
refresh token, para não disparar a detecção de reuso que derruba todas as sessões do dono.

**Problemas:**
- Se o dono troca a senha, a automação perde o acesso até ele reconectar. O painel mostra
  "Reconecte a automação".
- O limite de `/api/auth/*` (20 pedidos a cada 15 min por IP) é dividido entre todas as empresas,
  porque a automação sai de um IP só. Com o cache de sessão isso aguenta algumas dezenas de
  empresas, mas não escala.

**Proposta:** `POST /internal/businesses/:id/token`, protegido pela `x-internal-key`, que devolve um
token de acesso curto com papel OWNER (ou um papel `AUTOMATION`). Também serviria uma chave de API
por empresa, gerada pelo dono no painel. A automação deixaria de guardar senha.

## 2. Disponibilidade nas rotas de conversa

**Hoje:** `/internal/conversation/availability` aceita `limit` até 10. Para montar a lista
"manhã, tarde e noite" e achar o horário pedido ("quinta às 16h"), a automação usa a rota do
painel (`/api/availability`, `limit` até 100) com o token do dono. Sem a automação conectada, o
bot cai para 10 horários por dia.

**Proposta:** subir o `limit` das rotas internas para 100 ou aceitar `startAfter` / `time` para
paginar a partir de um horário.

## 3. Eventos quando a agenda muda pelo painel

**Hoje:** o relógio do n8n roda de 5 em 5 minutos e a automação compara a agenda (Google Agenda,
lembretes). O que muda pelo painel chega a esses lugares com até 5 minutos de atraso.

**Proposta:** uma tabela de eventos (outbox) ou um webhook configurável que avise
`appointment.created`, `appointment.updated` e `appointment.cancelled`. O n8n já tem onde
receber.

## 4. Pagamento no agendamento

**Hoje:** sinal, pagamento total, desconto e comprovante ficam no banco da automação
(`payments`). Na API, o horário pago vira `CONFIRMED`.

**Proposta:** campos opcionais no `Appointment` (`paymentStatus`, `paidCents`,
`discountCents`), para a Agenda e os Resultados do painel mostrarem isso sem consultar a
automação.

## 5. Origem dos bloqueios de horário

**Hoje:** `TimeBlock` tem só `reason`. Para saber o que foi criado pelo bot ("Compromisso do
dono", "Bloqueado pela Alexa"), a automação depende do texto.

**Proposta:** um campo `source` (`PANEL`, `WHATSAPP`, `ALEXA`, `GOOGLE`) e, se possível, um
`externalId` para os bloqueios importados do Google Agenda.

## 6. Horário semanal por dia

`PUT /api/business/hours` substitui a semana inteira. O painel antigo mandava só o dia de hoje
ao abrir o expediente e apagava os outros dias (já corrigido no front: ele lê a semana, troca o
dia e regrava). Uma rota `PUT /api/business/hours/:dayOfWeek`, ou um aviso na documentação, evita
que isso volte a acontecer.

## 7. Limite mensal de mensagens

`monthlyMessageLimit` existe e a cota funciona (`402 QUOTA_EXCEEDED`), mas não há rota para
definir o limite: hoje só dá para mudar pelo banco. Se o limite for o plano do cliente, cabe uma
rota de administração (protegida) ou um campo no cadastro.

## 8. Cadastro de empresa pelo painel

`POST /api/auth/register` existe, mas o painel não tem tela de cadastro (por enquanto, use
`automation/scripts/cadastrar-empresa.mjs`). Se o cadastro for aberto ao público, vale um
convite ou uma aprovação manual, para evitar empresas falsas consumindo a cota da Meta.

## 9. Pequenos

- `DELETE /api/employees/:id` só desativa. O nome `PATCH { active: false }` já cobre esse caso,
  e o DELETE poderia ser uma exclusão de verdade (quando não há agendamentos) ou sair da API.
- O WhatsApp às vezes entrega celulares do Brasil sem o 9º dígito (o `wa_id` vem com DDD e só
  8 dígitos, ex.: `551488887777`). A automação normaliza antes de chamar a API. Se outro cliente da API (outro canal) também
  precisar, cabe uma função compartilhada.
