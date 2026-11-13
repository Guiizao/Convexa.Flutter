# Catálogo de diálogos

Tudo o que o bot entende e responde, no WhatsApp (cliente e dono) e na Alexa (dono).
Os exemplos com 👤/🤖 foram copiados do simulador, rodando o teste ponta a ponta
(`automation/scripts/e2e.mjs`). O texto vem do código; se mudar lá, atualize aqui.

## Regras gerais

- **Três jeitos de responder.** Todo menu aceita: tocar no botão ou na lista, digitar o número
  da opção ("1", "opção 2") ou escrever do seu jeito ("quinta às 16h").
- **Limites da Meta, respeitados pelo bot.** Até 3 botões por mensagem (título com até 20
  caracteres), listas com até 10 linhas (título com até 24, descrição com até 72). Com muitos
  horários livres, o bot pergunta primeiro o período (manhã, tarde ou noite). A lista de dias
  termina em "Outra data", e o cliente sempre pode digitar o que quer.
- **Janela de 24 horas.** O bot só manda texto livre para quem falou com ele nas últimas 24 h.
  Fora disso (lembretes, remarcação pedida pelo dono, aviso de pagamento), usa os **modelos
  aprovados** listados no fim deste arquivo.
- **Entender texto livre.** Há duas camadas. A primeira são regras (`src/bot/nlu.ts` e
  `src/nlu/datetime.ts`), que entendem dia ("hoje", "amanhã", "quinta", "dia 20", "20/11"), hora
  ("16h", "às 4 da tarde", "meio-dia") e intervalo ("das 12 às 14", "a partir das 17"). A segunda
  é opcional: o Claude, ligado com `ANTHROPIC_API_KEY`, entra só quando as regras não
  entendem e reescreve a frase num comando que as regras conhecem. Sem a chave, o bot funciona
  com as regras.
- **Não entendi.** O bot nunca fica mudo: responde "Não entendi 🤔" e mostra o menu.
- **Dono x cliente.** Os números em *Automação → Números do dono* recebem o menu do dono.
  Qualquer outro número é tratado como cliente. O dono pode "testar como cliente" por 30 minutos.
- **Vários tipos de negócio.** O vocabulário muda conforme o *Tipo de estabelecimento*:

| Tipo | serviço | profissional |
|---|---|---|
| Barbearia | serviço | barbeiro / barbeiros |
| Salão de beleza | serviço | profissional |
| Estética | procedimento | profissional |
| Clínica / consultório | atendimento | profissional |
| Manicure e pedicure | serviço | manicure |
| Pet shop | serviço | profissional |
| Estúdio (tatuagem, cílios, sobrancelha) | sessão | artista |
| Personal / aulas | aula | instrutor |
| Outro | serviço | profissional |

Exemplo: numa clínica o bot pergunta "Qual atendimento?" e "Tem preferência de profissional?";
numa barbearia, "Qual serviço?" e "Tem preferência de barbeiro?".

---

## Cliente (WhatsApp)

### Menu

Aparece na saudação ("oi", "bom dia"), em "menu"/"ajuda" ou quando o bot não entende.

| Opção | id | Quando aparece |
|---|---|---|
| Agendar horário | `m:book` | sempre |
| Meus horários | `m:mine` | sempre |
| Remarcar | `m:resch` | se o cliente tem horário marcado |
| Cancelar horário | `m:cancel` | se o cliente tem horário marcado |
| Serviços e preços | `m:prices` | sempre |
| Endereço e horários | `m:info` | sempre |
| Falar com atendente | `m:human` | sempre |

### Intenções reconhecidas em texto livre

| Intenção | Exemplos que o bot entende |
|---|---|
| Agendar | "quero marcar", "tem horário amanhã?", "queria cortar o cabelo sexta às 10", "barba quinta 16h" |
| Meus horários | "quais são meus horários?", "quando é o meu?", "já estou marcado?" |
| Remarcar | "preciso remarcar", "dá pra mudar o horário?", "quero outro dia", "adiar" |
| Cancelar | "quero cancelar", "desmarca", "não vou poder ir" |
| Confirmar presença | "confirmo presença", "vou sim", "estou indo" |
| Preços | "quanto custa a barba?", "tabela", "o que vocês fazem?" |
| Informações | "onde fica?", "abrem domingo?", "aceita cartão?" |
| Pagamento | "paguei", "segue o comprovante", "pix" (ou uma foto/PDF) |
| Atendente | "quero falar com uma pessoa", "falar com o dono", "atendente" |
| Agradecimento | "obrigado", "valeu" |
| Sim / não | "sim", "pode", "beleza" / "não", "deixa pra lá" (só frases curtas) |

### Agendar (com texto livre, pagamento e comprovante)

O bot pula as perguntas que a frase já respondeu. Serviço, dia e hora numa mensagem só levam
direto à confirmação.

```
👤 oi! queria marcar barba quinta às 16h
🤖 Tem preferência de barbeiro?        {lista: Sem preferência | Lucas | Pedro}
👤 Sem preferência
🤖 Confere para mim:
   ✂️ Barba · 📅 Quinta-feira, 19/11 · 🕒 16:00 · 👤 com Pedro · 💰 R$ 35,00
                                        [Confirmar | Outro horário | Cancelar]
👤 Confirmar
🤖 Pronto, Paula! Seu horário está marcado ✅ … 📍 Rua Bahia, 120 - Centro, Marília/SP
🤖 Para garantir o horário, falta só o sinal de R$ 10,50 por Pix, em até 30 minutos.
   Pagando tudo agora você ganha 10% de desconto (R$ 31,50 em vez de R$ 35,00).
                                        [Sinal R$ 10,50 | Tudo R$ 31,50]
👤 Sinal R$ 10,50
🤖 Sinal de R$ 10,50 — Barba, qui, 19/11 às 16:00. Copie o código da próxima mensagem…
🤖 00020101021226690014br.gov.bcb.pix…   (Pix copia e cola)
🤖 [imagem do QR Code] Depois de pagar, me envie a foto do comprovante aqui 📎
👤 [foto do comprovante]
🤖 Recebi seu comprovante! 🙌 Assim que for conferido eu confirmo seu horário aqui.
   … o dono aprova no WhatsApp ou no painel …
🤖 Pagamento de R$ 10,50 confirmado! ✅ Seu horário de Barba está garantido: Qui, 19/11 às 16:00 com Pedro.
```

Passo a passo, quando a frase não traz tudo:

1. **Serviço.** Lista com os serviços ativos (`s:<id>`), mostrando preço e duração. Também
   entende o nome escrito ("cortar o cabelo" vira *Corte*; "corte e barba" vira *Corte + barba*).
2. **Profissional.** Só se *Perguntar o profissional* estiver ligado e mais de uma pessoa fizer o
   serviço. Opções: "Sem preferência" (`p:any`) ou um nome (`p:<id>`).
3. **Dia.** Lista com hoje, amanhã e os próximos dias com vaga (`d:<data>`), mais "Outra data"
   (`d:other`). Aceita "dia 25", "25/11", "semana que vem".
4. **Horário.** Lista com os horários livres (`t:<hora>:<profissional>`), agrupados por período,
   ou "Às 16:00 não tenho. Os horários mais próximos são…" quando o pedido está ocupado.
5. **Confirmação.** Botões Confirmar (`c:yes`), Outro horário (`c:change`) e Cancelar (`c:no`).
6. **Sinal.** Conforme *Sinal e pagamento antecipado*:
   - *Desligado*: termina na confirmação.
   - *Opcional*: Sinal (`pay:dep`), Tudo com desconto (`pay:full`) e Pagar no local (`pay:local`).
   - *Obrigatório*: Sinal ou Tudo com desconto. Sem pagamento no prazo, o horário é liberado e
     o cliente recebe o modelo `convexa_sinal_expirado` com o botão "Agendar de novo".
7. **Comprovante.**
   - *Minha chave Pix*: o cliente manda a foto. O n8n baixa a mídia, e o dono recebe a imagem
     com Aprovar/Recusar (`pv:ok:<id>` / `pv:no:<id>`). O dono também pode aprovar no painel,
     em *Automação → Comprovantes*. Com a IA ligada, o bot lê o comprovante e anota valor e data
     para o dono conferir. Quem aprova é sempre o dono.
   - *Mercado Pago*: o pagamento é confirmado sozinho pelo webhook, sem comprovante.

### Meus horários, remarcar e cancelar

```
👤 quais são meus horários?
🤖 Seu horário marcado:
   • Sex, 20/11 às 11:00 — Barba com Pedro ✅      [Remarcar | Cancelar | Agendar outro]
👤 quero cancelar
🤖 Cancelar Barba de sexta-feira, 20/11 às 11:00?
   Atenção: o sinal de R$ 10,50 não é devolvido no cancelamento.
                                        [Sim, cancelar | Não, manter | Prefiro remarcar]
👤 Sim, cancelar
🤖 Cancelado. Seu horário de sexta-feira, 20/11 às 11:00 foi liberado.   [Agendar outro | Menu]
```

- Com mais de um horário, o bot pergunta qual (`a:<fluxo>:<id>`).
- **Remarcar** mantém serviço e profissional e pergunta só dia e hora (`r:time:<id>`). O cliente
  pode trocar o serviço em `r:svc:<id>`.
- **Prazo.** Abaixo de *Cancelar ou remarcar pelo bot até X h antes*, o bot não cancela: avisa
  o prazo e oferece falar com atendente.
- **Sinal.** Se *Devolver o sinal se cancelar* estiver desligado, o bot avisa antes de confirmar,
  como no exemplo.

### Lembretes (automáticos)

Saem nos horários escolhidos em *Lembretes e resumo* (padrão: 24 h e 2 h antes). Fora da janela
de 24 h, vão como o modelo `convexa_lembrete`:

```
🤖 Olá, Paula! Lembrete do seu horário na Barbearia Navalha: Barba, sexta-feira 20/11 às 11:00,
   com Pedro. Você confirma?                      [Confirmo | Remarcar | Cancelar]
```

Botões: `rem:ok:<id>` (marca como confirmado na agenda), `rem:resch:<id>` e `rem:cancel:<id>`.

### Serviços, preços e informações

- "Serviços e preços" lista nome, duração e preço de cada serviço ativo, com o botão "Agendar".
- "Endereço e horários" mostra endereço, link do mapa, horário de funcionamento (lido da API) e
  formas de pagamento.

### Atendente humano

```
👤 quero falar com um atendente
🤖 Certo! Já chamei alguém da equipe para falar com você. Enquanto isso, pode ir escrevendo sua dúvida por aqui 🙂
```

- O bot fica pausado **só para esse cliente** durante *Pausa do bot no atendimento humano*
  (padrão: 2 h).
- O dono recebe a última mensagem do cliente e o botão "Reativar bot" (`hb:<telefone>`). Cada nova
  mensagem do cliente chega para ele com 💬.
- O dono responde pelo painel (*Automação → Conversas*). A resposta sai pelo número do
  estabelecimento.

### Remarcação pedida pelo dono

Quando o dono bloqueia um horário que já tinha cliente e escolhe "Pedir p/ remarcar", o cliente
recebe:

```
🤖 Olá, Paula! Aqui é da Barbearia Navalha. Precisamos ajustar a agenda e o seu horário de Barba
   (Qui, 19/11 às 16:00) não vai poder ser mantido. Desculpe o transtorno 🙏
   Escolha um novo horário:                       [Escolher horário | Cancelar]
👤 Escolher horário
🤖 Qual dia fica melhor para Barba?   {lista: Hoje | Amanhã | Segunda, 16/11 | … | Outra data}
👤 sexta às 11h
🤖 Novo horário: … 📅 Sexta-feira, 20/11 · 🕒 11:00 …   [Confirmar | Outro horário | Cancelar]
👤 Confirmar
🤖 Pronto, Paula! Remarquei para sexta-feira, 20/11 às 11:00 com Pedro. ✅
```

Fora da janela de 24 h, sai como o modelo `convexa_remarcacao`. Botões: `cp:resch:<id>`,
`cp:cancel:<id>` e, nos avisos, `cp:ok:<id>`.

---

## Dono (WhatsApp)

### Menu

| Grupo | Opção | id |
|---|---|---|
| Agenda | Agenda de hoje | `o:today` |
| Agenda | Agenda de amanhã | `o:tomorrow` |
| Agenda | Próximo cliente | `o:next` |
| Agenda | Horários livres hoje | `o:free` |
| Gestão | Faturamento do mês | `o:rev:month` |
| Gestão | Bloquear horário | `o:block` |
| Gestão | Avisar clientes | `o:notice` |
| Gestão | Comprovantes | `o:pending` |
| Gestão | Pausar o bot / Ativar o bot | `o:pause` / `o:resume` |
| Gestão | Testar como cliente (30 min) | `o:as_customer` |

### Comandos em texto livre

| O dono escreve | O bot faz |
|---|---|
| "o que eu tenho hoje?", "agenda de quinta", "quantos clientes amanhã?" | Lista o dia (✅ confirmado ou pago, ✔️ atendido, • marcado) e o total previsto |
| "quem é o próximo?" | Próximo cliente, serviço e horário |
| "horários livres quinta", "tenho vaga amanhã?" | Janelas livres por profissional |
| "quanto faturei esse mês?", "qual o lucro?", "faturamento de hoje" | Realizado, a receber, previsto, descontos do Pix, cancelados, serviço mais pedido e lucro estimado (com o *Custo médio* do painel) |
| "amanhã das 12 às 14 vou estar ocupado", "bloqueia sexta o dia todo" | Bloqueia o intervalo; se houver cliente marcado, pergunta o que fazer |
| "amanhã ao meio-dia vou estar ocupado, reajusta minha agenda" | Pergunta "Até que horas a partir das 12:00?" e segue igual |
| "hoje vou sair mais cedo, às 17h" | Bloqueia das 17h até o fim do dia e trata quem estiver marcado |
| "amanhã só chego às 10" | Bloqueia do início do dia até as 10h |
| "sábado não vou abrir", "folga na segunda" | Bloqueia o dia inteiro |
| "avisa meus clientes de hoje que vou atrasar 15 min" | Mostra o texto e quantos clientes vão receber, e só envia depois do "Enviar" (`on:send`) |
| "vou me atrasar 20 minutos" | Monta o aviso para os clientes das próximas 3 h e só envia depois do "Enviar" |
| "cancela o horário da Ana" | Mostra o agendamento e pede confirmação (`oc:yes:<id>`) |
| "tem comprovante pendente?" | Lista os comprovantes com Aprovar / Recusar |
| "pausa o bot" / "liga o bot" | Desliga ou religa o atendimento automático para todos |
| "modo cliente" / "modo dono" | Testa o fluxo do cliente no próprio número / volta ao modo dono |

### Bloquear e reajustar a agenda

```
👤 quinta das 15h30 às 17h vou estar ocupado, reajusta minha agenda
🤖 Bloquear a agenda de quem?          {lista: De todos | Lucas | Pedro}
👤 De todos
🤖 🔒 Bloqueei quinta-feira, 19/11 das 15:30 às 17:00. Mas tem 1 cliente marcado nesse intervalo:
   • 16:00 Paula Teste — Barba
   O que eu faço com esse horário?     [Pedir p/ remarcar | Cancelar e avisar | Deixar como está]
👤 Pedir p/ remarcar
🤖 📨 Mandei mensagem para Paula Teste pedindo para escolher outro horário. Te aviso aqui conforme cada um responder.
🤖 ✅ Paula Teste remarcou para sex, 20/11 às 11:00. Todos os clientes afetados já responderam 👌
```

- Sem conflito: "🔒 Pronto, bloqueei…", com o botão **Desfazer** (`o:undo:<id>`).
- "Cancelar e avisar" cancela na agenda e manda o aviso com o botão Remarcar.
- "Deixar como está" mantém os agendamentos. O bloqueio só impede novos.

### Avisos que o dono recebe

| Quando | Mensagem |
|---|---|
| Novo agendamento, cancelamento ou remarcação (se ligado) | "📅 Novo agendamento: Paula Teste ((14) 9…) — Barba, qui, 19/11 às 16:00 com Pedro." |
| Comprovante recebido | a imagem do comprovante e "Aprovar o pagamento de Paula Teste?" [Aprovar \| Recusar] |
| Cliente pediu atendente | "🙋 … pediu para falar com uma pessoa" [Reativar bot] |
| Resumo do dia (se ligado) | de manhã: clientes do dia, valor previsto e comprovantes pendentes |
| Fora da janela de 24 h | modelo `convexa_aviso_dono` ("Novidade na agenda da …") com o botão "Abrir menu" |

---

## Dono (Alexa)

Skill em `automation/alexa/skill-package`, com o nome de invocação **"agenda convexa"**. Para vincular,
gere um código de 6 dígitos no painel (*Automação → Integrações → Alexa*) e diga
"Alexa, abrir agenda convexa" e depois "vincular código 1 2 3 4 5 6".

| Intenção | Exemplos de fala |
|---|---|
| VincularIntent | "vincular código {código}", "o código é {código}" |
| AgendaIntent | "qual a minha agenda", "como está a agenda amanhã" |
| ProximoClienteIntent | "quem é o próximo cliente" |
| HorariosLivresIntent | "quais horários estão livres amanhã", "tenho horário vago sexta" |
| FaturamentoIntent | "quanto eu faturei este mês", "qual o faturamento de hoje" |
| LucroIntent | "qual o lucro este mês", "quanto eu lucrei" |
| BloquearIntent | "bloqueia amanhã das 12 às 14", "vou estar ocupado sexta das 15 às 17" |
| SairMaisCedoIntent | "hoje vou sair às 17" |
| ChegarMaisTardeIntent | "amanhã só chego às 10" |
| AvisarClientesIntent | "avisa meus clientes de hoje que {mensagem}" |
| AvisarClientesAmanhaIntent | "avisa meus clientes de amanhã que {mensagem}" |
| AtrasoIntent | "vou me atrasar 15 minutos" |
| ComprovantesIntent | "tem comprovante pendente" |
| PausarBotIntent / AtivarBotIntent | "pausa o bot" / "liga o bot" |
| Ajuda, Parar, Cancelar, Sim, Não | padrão da Amazon |

Respostas reais da skill (geradas localmente pelo n8n):

```
🗣 Alexa, pergunte à agenda convexa quem é o próximo cliente.
🔊 O próximo é Simulação n8n, amanhã às 10 horas, para Corte com Pedro.

🗣 Alexa, diga à agenda convexa que amanhã às 9 e meia vou estar ocupado.
🔊 Bloqueei amanhã das 9 e meia às 10 e meia. Mas tem um cliente marcado: Simulação às 10 horas.
   Quer que eu peça pelo WhatsApp para remarcarem?
🗣 Sim.
🔊 Feito. Mandei mensagem no WhatsApp para Simulação n8n escolher outro horário. Te aviso por lá.

🗣 Alexa, pergunte à agenda convexa quais horários estão livres amanhã.
🔊 Horários livres amanhã. Lucas: das 10 e meia ao meio-dia e das 13 horas às 19 horas. …
```

Se a frase só tem a hora de início ("amanhã ao meio-dia vou estar ocupado"), a Alexa bloqueia
uma hora e avisa que dá para pedir um intervalo maior.

Ações que mexem com clientes (avisar, pedir remarcação) sempre pedem um "sim" antes. O envio
sai pelo WhatsApp do estabelecimento, pelo mesmo caminho do bot.

---

## Modelos de mensagem (cadastrar na Meta)

Categoria **Utilidade**, idioma **pt_BR**. Os textos estão em
`automation/simulator/templates.json` (o simulador rejeita envios que não batem com eles). Os
botões são de **resposta rápida**.

| Nome | Texto | Botões |
|---|---|---|
| `convexa_lembrete` | Olá, {{1}}! Lembrete do seu horário na {{2}}: {{3}}, {{4}} às {{5}}, com {{6}}. Você confirma? | Confirmo · Remarcar · Cancelar |
| `convexa_remarcacao` | Olá, {{1}}. A {{2}} precisou ajustar a agenda de {{3}} e o seu horário das {{4}} não poderá ser mantido. Pedimos desculpas! Toque em Escolher horário para remarcar. | Escolher horário · Cancelar |
| `convexa_aviso` | Olá, {{1}}. Aviso da {{2}} sobre o seu horário de {{3}}: {{4}} | Ok, entendi · Remarcar |
| `convexa_pagamento_confirmado` | Pagamento recebido! Seu horário de {{1}} em {{2}} às {{3}} na {{4}} está confirmado. | — |
| `convexa_sinal_expirado` | O prazo do sinal acabou e o seu horário de {{1}} ({{2}}) na {{3}} foi liberado. Se ainda quiser, toque em Agendar de novo. | Agendar de novo |
| `convexa_aviso_dono` | Novidade na agenda da {{1}}: {{2}} | Abrir menu |
| `convexa_comprovante` | {{1}} enviou um comprovante de {{2}} referente a {{3}}. Confira na sua conta antes de aprovar. | Aprovar · Recusar |

Enquanto um modelo não estiver aprovado, a mensagem correspondente só chega para quem falou com
o número nas últimas 24 h.
