# Guia de configuração (colocar no ar)

Ordem recomendada. Cada etapa diz **o que criar**, **onde colar** e **como testar**. Nada aqui
exige mexer em código.

| # | Etapa | Obrigatória? | Quem faz |
|---|---|---|---|
| 1 | Servidor e domínio | sim | você (uma vez) |
| 2 | E-mail transacional (Resend) | sim, a ConvexaAPI exige em produção | você (uma vez) |
| 3 | Subir tudo com Docker | sim | você (uma vez) |
| 4 | n8n: conta de dono e workflows | sim | você (uma vez) |
| 5 | Cadastrar cada estabelecimento | sim | você, por cliente |
| 6 | WhatsApp oficial (Meta) | sim | você + dono, por número |
| 7 | Modelos de mensagem na Meta | sim, para lembretes e avisos | você (uma vez por conta da Meta) |
| 8 | Painel: serviços, equipe, automação | sim | dono |
| 9 | Pix: chave ou Mercado Pago | opcional | dono |
| 10 | Google Agenda | opcional | você (uma vez) + dono |
| 11 | Alexa | opcional | você (uma vez) + dono |
| 12 | IA (Claude) | opcional | você (uma vez) |

---

## 1. Servidor e domínio

**Por que um servidor (VPS) e não só Vercel/Cloudflare:** o n8n e o serviço de automação ficam
ligados o tempo todo (relógio de 5 em 5 minutos, webhooks da Meta, da Alexa e do Mercado Pago).
A ConvexaAPI precisa de PostgreSQL com conexão direta, porque usa transações `Serializable`. Isso
descarta pooler em modo transação e bancos que não são Postgres, como o D1 da Cloudflare. Um VPS
com Docker roda tudo junto e sai mais barato.

- **Servidor:** Ubuntu 24.04, 2 vCPU, 4 GB de RAM e 40 GB de disco já atendem dezenas de
  estabelecimentos. Exemplos: Hetzner, Contabo, DigitalOcean, Hostinger VPS.
- **Instale:** Docker e o plugin Compose (`curl -fsSL https://get.docker.com | sh`), mais `git` e `node` 20+
  (o node é só para o script de instalação dos workflows).
- **Domínio:** crie 4 registros **A** apontando para o IP do servidor:
  `api.`, `auto.`, `n8n.` e `painel.` (ex.: `api.convexa.com.br`). Se usar a Cloudflare no DNS,
  deixe a nuvem **cinza** (sem proxy) na primeira subida, para o Caddy conseguir emitir os
  certificados.
- **Firewall:** libere só as portas 22, 80 e 443.

> **Alternativa para o painel:** ele é um site estático. Também pode ir para a Vercel ou para o
> Cloudflare Pages: rode o `flutter build web` com os mesmos `--dart-define` do
> `deploy/build-painel.sh` e publique a pasta `build/web`. Nesse caso, troque
> `https://painel.${DOMAIN}` em `CORS_ORIGINS` e `APP_URL`, no `docker-compose.yml`, pelo
> endereço do painel.

## 2. E-mail transacional (Resend)

A ConvexaAPI só sobe em produção com e-mail configurado (é o "esqueci a senha").

1. Crie a conta em resend.com, vá em **Domains**, adicione o seu domínio e crie os registros DNS
   que ele pedir.
2. Em **API Keys**, crie uma chave. Ela vai em `RESEND_API_KEY`.
3. Em `MAIL_FROM`, use um remetente do domínio verificado, como `Convexa <nao-responda@seudominio.com.br>`.

## 3. Subir tudo com Docker

No servidor, clone os dois repositórios **lado a lado**:

```bash
mkdir -p /opt/convexa && cd /opt/convexa
git clone https://github.com/Guiizao/Convexa.Flutter.git
git clone <repositório da ConvexaAPI do Gabriel> convexaapi
cd Convexa.Flutter/automation/deploy
./gerar-segredos.sh          # cria o .env com todos os segredos aleatórios
nano .env                    # preencha DOMAIN, ACME_EMAIL, RESEND_API_KEY, MAIL_FROM
```

Gere o painel (numa máquina com Flutter; pode ser o seu PC) e copie para `deploy/painel/`:

```bash
DOMAIN=seudominio.com.br ./build-painel.sh
# se gerou no PC: scp -r painel/* servidor:/opt/convexa/Convexa.Flutter/automation/deploy/painel/
```

Suba:

```bash
docker compose up -d --build
docker compose ps            # api-migrate e automacao-migrate terminam com "exited (0)"
curl https://api.seudominio.com.br/health
curl https://auto.seudominio.com.br/health
```

O que sobe: Postgres 16 (bancos `convexa`, `convexa_automacao` e `n8n`), ConvexaAPI (construída a
partir do repositório do Gabriel, sem alterações), convexa-automacao, n8n 2.47.5 e o Caddy
(HTTPS automático, que serve o painel). As rotas `/internal` da API **não** ficam expostas na
internet.

**Backup:** guarde o `.env` num lugar seguro. Sem ele, os tokens cifrados no banco ficam
ilegíveis. Faça backup do banco com
`docker compose exec db pg_dumpall -U convexa > backup.sql` (de preferência todo dia, por cron).

**Atualizar depois:** `git pull` nos dois repositórios e `docker compose up -d --build`.

## 4. n8n: conta de dono e workflows

1. Abra `https://n8n.seudominio.com.br` **logo depois da primeira subida** e crie a conta de
   dono. Quem abrir primeiro vira o dono.
2. Instale os workflows (eles leem as chaves do `.env` e viram credenciais cifradas do n8n):

```bash
cd /opt/convexa/Convexa.Flutter/automation/n8n
set -a; . ../deploy/.env; set +a
CONTAINER=convexa-n8n ./setup.sh
```

3. No n8n, confira se os 5 workflows estão **publicados**: Enviar lote, WhatsApp entrada,
   Relógio, Alexa e Mercado Pago.

## 5. Cadastrar cada estabelecimento

O painel ainda não tem tela de cadastro. Use o script (rode no servidor ou no seu PC):

```bash
cd /opt/convexa/Convexa.Flutter/automation/scripts
API_URL=https://api.seudominio.com.br SENHA='senha-forte-do-dono' node cadastrar-empresa.mjs \
  --nome "Barbearia Navalha" --slug barbearia-navalha --telefone "(14) 99999-0000" \
  --dono "Rafael Souza" --email dono@navalha.com.br
```

Passe a senha ao dono por um canal seguro e peça que ele a troque.

## 6. WhatsApp oficial (Meta Cloud API)

O número do WhatsApp **não pode estar em uso** no app do WhatsApp nem no WhatsApp Business. Use um
chip novo ou apague a conta do app nesse número antes de cadastrar.

1. **Conta empresarial:** em business.facebook.com, crie (ou use) o portfólio empresarial do
   estabelecimento. Para sair dos limites de teste, faça a **verificação da empresa** (CNPJ e
   documentos).
2. **App:** em developers.facebook.com → *Meus apps* → *Criar app* → tipo **Empresa** → adicione o
   produto **WhatsApp**.
3. **Número:** em *WhatsApp → Configuração da API*, adicione o número de produção e confirme por
   SMS. Anote:
   - **Phone Number ID** (identificação do número de telefone)
   - **WABA ID** (identificação da conta do WhatsApp Business)
4. **Token permanente:** em *Configurações do negócio → Usuários do sistema*, crie um usuário do
   sistema (administrador), atribua a ele o app e a conta do WhatsApp com controle total e gere
   um token **sem expiração** com as permissões `whatsapp_business_messaging` e
   `whatsapp_business_management`.
5. **App Secret:** em *Configurações do app → Básico*, copie a **Chave secreta do aplicativo**.
6. **Webhook:** em *WhatsApp → Configuração*:
   - URL de callback: `https://n8n.seudominio.com.br/webhook/whatsapp`
   - Token de verificação: o valor de `WHATSAPP_VERIFY_TOKEN` no `.env`
   - Clique em *Verificar e salvar* e **assine o campo `messages`**.
7. **Coloque no painel:** o dono entra em *Configurações → WhatsApp do estabelecimento* e cola o
   Phone Number ID, o WABA ID, o token e o App Secret. O token e o secret vão cifrados para a
   ConvexaAPI e nunca voltam para a tela.
8. **Versão da API:** confira em *Configuração da API* qual versão aparece no exemplo de `curl`
   (ex.: `v24.0`) e coloque em `GRAPH_API_VERSION` no `.env`
   (`docker compose up -d n8n` para aplicar).

**Teste:** mande "oi" para o número. O bot deve responder com o menu. Se não responder, veja as
*Execuções* do workflow "WhatsApp entrada" no n8n.

## 7. Modelos de mensagem na Meta

Fora da janela de 24 h, a Meta só entrega mensagens por modelo aprovado. Em *WhatsApp Manager →
Modelos de mensagem*, crie os 7 modelos da tabela no fim de `02-dialogos.md`, com **categoria
Utilidade**, **idioma Português (BR)**, o texto exatamente igual e os botões de **resposta
rápida**. A aprovação costuma sair em minutos ou em algumas horas.

Enquanto não forem aprovados, o bot funciona normalmente com quem falou nas últimas 24 h.
Lembretes e avisos para os outros clientes ficam pendentes.

## 8. Painel: serviços, equipe e automação (o dono faz)

1. **Serviços:** nome, duração e preço de cada serviço.
2. **Equipe:**
   - **Horário de funcionamento** da semana. Sem ele, a agenda não oferece nenhum horário.
   - **Profissionais:** os serviços que cada um faz e o horário de cada um, com a pausa do
     almoço.
3. **Automação:**
   - **Conectar a automação** (confirmar a senha do painel uma vez).
   - **Atendimento:** tipo de estabelecimento, endereço e **números do dono** (os números que
     mandam comandos ao bot).
   - **Lembretes e resumo do dia.**
   - **Sinal e pagamento antecipado** (veja a etapa 9).
4. **Teste como cliente:** pelo WhatsApp do dono, mande "modo cliente" e faça um agendamento de
   ponta a ponta. Para voltar, mande "modo dono".

## 9. Pix

**Opção A — Chave Pix própria (sem custo):** em *Automação → Sinal e pagamento antecipado*,
escolha "Minha chave Pix" e informe a chave, o nome do recebedor (até 25 letras) e a cidade. O
bot gera o Pix copia e cola e o QR Code, e o cliente manda a foto do comprovante. O dono aprova
no WhatsApp ou no painel **depois de conferir no banco**, porque foto de comprovante pode ser
editada.

**Opção B — Mercado Pago (confirmação automática):**
1. Em mercadopago.com.br/developers → *Suas integrações* → crie uma aplicação → *Credenciais de
   produção* → copie o **Access Token** (`APP_USR-…`).
2. No painel: *Automação → Sinal → Mercado Pago*, cole o Access Token e clique em *Salvar
   credenciais*.
3. (Recomendado) Em *Webhooks* da aplicação no Mercado Pago, gere a **assinatura secreta** e cole
   no campo *Assinatura secreta do webhook*. Com ela, o sistema recusa avisos falsos.
4. Não precisa cadastrar URL de webhook: cada cobrança já leva a URL de aviso
   (`https://n8n.seudominio.com.br/webhook/mercadopago/<empresa>`). Mesmo assim, o sistema
   sempre consulta o pagamento na API do Mercado Pago antes de confirmar.

## 10. Google Agenda

**Uma vez (você):**
1. Em console.cloud.google.com, crie um projeto e ative a **Google Calendar API**.
2. Na *Tela de permissão OAuth*, escolha o tipo **Externo**, informe o nome do app, o e-mail de
   suporte e o domínio. Adicione os escopos `calendar.events` e `calendar.readonly`.
3. Em *Credenciais → Criar credenciais → ID do cliente OAuth*, escolha o tipo **Aplicativo da
   Web**, com o URI de redirecionamento autorizado
   `https://auto.seudominio.com.br/v1/google/callback`.
4. Coloque o ID e o segredo em `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env` e rode
   `docker compose up -d automacao`.
5. Enquanto o app estiver "Em teste" no Google, só os e-mails cadastrados como **usuários de
   teste** conseguem conectar. Para liberar para todos, publique o app. Como os escopos são
   sensíveis, o Google pede uma verificação.

**Por estabelecimento (dono):** *Automação → Integrações → Conectar Google Agenda*. Cada
agendamento vira um evento no Google Agenda. Com *Compromissos do Google bloqueiam a agenda*
ligado, um compromisso pessoal no Google vira horário bloqueado no Convexa. A sincronização roda
a cada 5 minutos.

## 11. Alexa

**Uma vez (você):**
1. Em developer.amazon.com → *Alexa Skills Kit* → *Create Skill*, use o nome "Agenda Convexa", o
   idioma **Portuguese (BR)**, o modelo **Custom** e a hospedagem **Provision your own**.
2. Em *Interaction Model → JSON Editor*, cole o conteúdo de
   `automation/alexa/skill-package/interactionModels/custom/pt-BR.json` e clique em *Build*.
3. Em *Endpoint*, escolha **HTTPS** com `https://n8n.seudominio.com.br/webhook/alexa`, opção
   *"My development endpoint has a certificate from a trusted certificate authority"*.
4. Copie o **Skill ID** (`amzn1.ask.skill…`) para `ALEXA_SKILL_ID` no `.env` e rode
   `docker compose up -d automacao`.
5. Na aba *Test*, ative o teste em *Development* e diga "abrir agenda convexa".
6. Para outras pessoas usarem, publique a skill (certificação da Amazon) ou, para poucos donos,
   adicione as contas Amazon deles como *beta testers*.

**Por estabelecimento (dono):** *Automação → Integrações → Gerar código de vínculo* e, no Echo:
"Alexa, abrir agenda convexa" e depois "vincular código 1 2 3 4 5 6". O código vale 15 minutos.

## 12. IA (Claude) — opcional

Sem chave, o bot entende por regras (veja `02-dialogos.md`). Com a chave, ele também entende
frases fora do padrão e lê o comprovante para ajudar o dono a conferir.

1. Em console.anthropic.com → *API Keys*, crie uma chave e coloque em `ANTHROPIC_API_KEY` no `.env`.
2. `docker compose up -d automacao`. O painel passa a mostrar "IA ligada".

O modelo padrão é o `claude-opus-5-5` (`ANTHROPIC_MODEL` troca o modelo). A IA só é chamada quando
as regras não entendem a frase, então o custo acompanha o volume de mensagens "difíceis".

---

## Checklist final de testes em produção

- [ ] `https://painel.seudominio.com.br` abre e o login funciona.
- [ ] Mandar "oi" no WhatsApp traz o menu do bot.
- [ ] Agendar pelo WhatsApp faz o horário aparecer na Agenda do painel.
- [ ] O número do dono recebe o aviso do novo agendamento.
- [ ] Com o sinal ligado: o Pix é gerado, o comprovante chega ao dono e a aprovação confirma o horário.
- [ ] No WhatsApp do dono, "o que eu tenho amanhã?" e "amanhã ao meio-dia vou estar ocupado" funcionam.
- [ ] Um lembrete chega no horário configurado (depende dos modelos aprovados).
- [ ] (Opcional) O evento aparece no Google Agenda.
- [ ] (Opcional) A Alexa responde "quem é o próximo cliente".
