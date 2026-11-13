// Gera os workflows do n8n em ./workflows (JSON importável).
// Uso: node build-workflows.mjs
import { writeFileSync } from "node:fs";

const CRED_INTERNAL = { httpHeaderAuth: { id: "cvxInternalKey01", name: "Convexa API (chave interna)" } };
const CRED_AUTOMACAO = { httpHeaderAuth: { id: "cvxAutomacaoKey1", name: "Convexa Automação (chave)" } };
const ID = {
  enviar: "cvxEnviarLote001",
  entrada: "cvxWhatsappIn001",
  relogio: "cvxRelogio000001",
  alexa: "cvxAlexa00000001",
  mp: "cvxMercadoPago01",
};

let x = 0;
const node = (name, type, typeVersion, parameters, extra = {}) => ({
  id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${++x}`,
  name,
  type,
  typeVersion,
  position: [0, 0],
  parameters,
  ...extra,
});
const at = (n, xPos, yPos) => ((n.position = [xPos, yPos]), n);
const link = (connections, from, to, output = 0) => {
  connections[from] ??= { main: [] };
  while (connections[from].main.length <= output) connections[from].main.push([]);
  connections[from].main[output].push({ node: to, type: "main", index: 0 });
};
const workflow = (id, name, nodes, connections, extra = {}) => ({
  id,
  name,
  nodes,
  connections,
  settings: { executionOrder: "v1", saveManualExecutions: true, callerPolicy: "workflowsFromSameOwner" },
  pinData: {},
  active: false,
  ...extra,
});

const http = (name, { method, url, cred, body, headers, neverError = false, batch, timeout = 20000 }) =>
  node(name, "n8n-nodes-base.httpRequest", 4.5, {
    method,
    url,
    ...(cred ? { authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth" } : {}),
    ...(headers ? { sendHeaders: true, specifyHeaders: "json", jsonHeaders: headers } : {}),
    ...(body ? { sendBody: true, specifyBody: "json", jsonBody: body } : {}),
    options: {
      timeout,
      ...(neverError ? { response: { response: { neverError: true, fullResponse: true } } } : {}),
      ...(batch ? { batching: { batch } } : {}),
    },
  }, cred ? { credentials: cred } : {});

const code = (name, js) => node(name, "n8n-nodes-base.code", 2, { mode: "runOnceForAllItems", language: "javaScript", jsCode: js });
const callEnviar = (name) =>
  node(name, "n8n-nodes-base.executeWorkflow", 1.4, {
    source: "database",
    workflowId: { __rl: true, mode: "id", value: ID.enviar },
    mode: "once",
    options: { waitForSubWorkflow: false },
  });

// =========================================================== 1. Enviar lote
{
  const c = {};
  const t1 = at(node("Chamado por outro workflow", "n8n-nodes-base.executeWorkflowTrigger", 1.3, { inputSource: "passthrough" }), 0, 0);
  const t2 = at(
    node("Lote vindo do serviço", "n8n-nodes-base.webhook", 2.2, {
      httpMethod: "POST",
      path: "convexa-enviar",
      authentication: "headerAuth",
      responseMode: "onReceived",
      options: {},
    }, { webhookId: "convexa-enviar", credentials: CRED_AUTOMACAO }),
    0,
    220,
  );
  const flat = at(
    code(
      "Achatar mensagens",
      `// Recebe { batches: [{ phoneNumberId, messages: [{ to, graph, preview }] }] } e devolve uma mensagem por item, na ordem.
const out = [];
for (const item of $input.all()) {
  const src = item.json.batches ? item.json : (item.json.body ?? {});
  for (const b of src.batches ?? []) {
    for (const m of b.messages ?? []) out.push({ json: { phoneNumberId: b.phoneNumberId, to: m.to, graph: m.graph, preview: m.preview } });
  }
}
return out;`,
    ),
    260,
    100,
  );
  const quota = at(
    http("Consumir cota", {
      method: "POST",
      url: "={{ $env.CONVEXA_API_URL }}/internal/messages/quota",
      cred: CRED_INTERNAL,
      body: '={{ JSON.stringify({ phoneNumberId: $json.phoneNumberId, count: 1 }) }}',
      neverError: true,
    }),
    500,
    100,
  );
  const ok = at(
    node("Dentro da cota?", "n8n-nodes-base.if", 2.4, {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 3 },
        conditions: [{ id: "q1", leftValue: "={{ $json.statusCode }}", rightValue: 300, operator: { type: "number", operation: "lt" } }],
        combinator: "and",
      },
      looseTypeValidation: true,
      options: {},
    }),
    740,
    100,
  );
  const creds = at(
    http("Token da Meta", {
      method: "GET",
      url: "={{ $env.CONVEXA_API_URL }}/internal/integrations/by-phone-number-id/{{ $('Achatar mensagens').item.json.phoneNumberId }}",
      cred: CRED_INTERNAL,
    }),
    980,
    0,
  );
  const send = at(
    http("Enviar pela Meta", {
      method: "POST",
      url: "={{ $env.GRAPH_API_BASE }}/{{ $env.GRAPH_API_VERSION }}/{{ $('Achatar mensagens').item.json.phoneNumberId }}/messages",
      headers: '={{ JSON.stringify({ Authorization: "Bearer " + $json.metaAccessToken }) }}',
      body: "={{ JSON.stringify($('Achatar mensagens').item.json.graph) }}",
      neverError: true,
      // uma por vez, com intervalo: a Meta não garante a ordem de mensagens disparadas juntas
      batch: { batchSize: 1, batchInterval: 600 },
    }),
    1220,
    0,
  );
  const result = at(
    code(
      "Resultado do envio",
      `return $input.all().map((item, i) => {
  const msg = $('Achatar mensagens').all()[i]?.json ?? {};
  const ok = item.json.statusCode >= 200 && item.json.statusCode < 300;
  return { json: { ok, to: msg.to, preview: (msg.preview ?? '').slice(0, 80), status: item.json.statusCode, erro: ok ? undefined : item.json.body } };
});`,
    ),
    1460,
    0,
  );
  const over = at(node("Cota estourada (não envia)", "n8n-nodes-base.noOp", 1, {}), 980, 220);
  link(c, t1.name, flat.name);
  link(c, t2.name, flat.name);
  link(c, flat.name, quota.name);
  link(c, quota.name, ok.name);
  link(c, ok.name, creds.name, 0);
  link(c, ok.name, over.name, 1);
  link(c, creds.name, send.name);
  link(c, send.name, result.name);
  writeFileSync("workflows/1-enviar-lote.json", JSON.stringify(workflow(ID.enviar, "Convexa · Enviar mensagens (lote)", [t1, t2, flat, quota, ok, creds, send, result, over], c), null, 2));
}

// =========================================================== 2. WhatsApp entrada
{
  const c = {};
  const verify = at(
    node("Meta confirma o webhook (GET)", "n8n-nodes-base.webhook", 2.2, { httpMethod: "GET", path: "whatsapp", responseMode: "responseNode", options: {} }, { webhookId: "whatsapp-get" }),
    0,
    -200,
  );
  const tokenOk = at(
    node("Token confere?", "n8n-nodes-base.if", 2.4, {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 3 },
        conditions: [{ id: "v1", leftValue: "={{ $json.query['hub.verify_token'] }}", rightValue: "={{ $env.WHATSAPP_VERIFY_TOKEN }}", operator: { type: "string", operation: "equals" } }],
        combinator: "and",
      },
      looseTypeValidation: true,
      options: {},
    }),
    240,
    -200,
  );
  const challenge = at(
    node("Devolver desafio", "n8n-nodes-base.respondToWebhook", 1.5, { respondWith: "text", responseBody: "={{ $json.query['hub.challenge'] }}", options: { responseCode: 200 } }),
    480,
    -280,
  );
  const deny = at(node("Recusar", "n8n-nodes-base.respondToWebhook", 1.5, { respondWith: "text", responseBody: "token inválido", options: { responseCode: 403 } }), 480, -120);

  const hook = at(
    node("Mensagem da Meta (POST)", "n8n-nodes-base.webhook", 2.2, { httpMethod: "POST", path: "whatsapp", responseMode: "onReceived", options: { rawBody: true } }, { webhookId: "whatsapp-post" }),
    0,
    100,
  );
  const prep = at(
    code(
      "Preparar",
      `// Corpo cru (para conferir a assinatura da Meta) e mídias a baixar
const item = $input.first();
let rawBody;
if (item.binary?.data) {
  rawBody = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');
} else {
  rawBody = JSON.stringify(item.json.body);
}
const payload = JSON.parse(rawBody);
const mediaIds = [];
let phoneNumberId = null;
for (const e of payload.entry ?? []) for (const ch of e.changes ?? []) {
  phoneNumberId = ch.value?.metadata?.phone_number_id ?? phoneNumberId;
  for (const m of ch.value?.messages ?? []) {
    const media = m.image ?? m.document;
    if (media?.id) mediaIds.push(media.id);
  }
}
const h = item.json.headers ?? {};
return [{ json: { rawBody, signature: h['x-hub-signature-256'] ?? null, phoneNumberId, mediaIds, hasMessages: (rawBody.includes('"messages"')) } }];`,
    ),
    240,
    100,
  );
  const hasMedia = at(
    node("Tem foto/arquivo?", "n8n-nodes-base.if", 2.4, {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 3 },
        conditions: [{ id: "m1", leftValue: "={{ $json.mediaIds.length }}", rightValue: 0, operator: { type: "number", operation: "gt" } }],
        combinator: "and",
      },
      looseTypeValidation: true,
      options: {},
    }),
    480,
    100,
  );
  const metaToken = at(
    http("Token da Meta (mídia)", {
      method: "GET",
      url: "={{ $env.CONVEXA_API_URL }}/internal/integrations/by-phone-number-id/{{ $json.phoneNumberId }}",
      cred: CRED_INTERNAL,
    }),
    720,
    0,
  );
  const download = at(
    code(
      "Baixar mídia",
      `// Comprovante do cliente: pega a URL na Graph API e baixa o arquivo (até 10 MB)
const prep = $('Preparar').first().json;
const token = $input.first().json.metaAccessToken;
const media = {};
for (const id of prep.mediaIds) {
  const info = await this.helpers.httpRequest({ method: 'GET', url: \`\${$env.GRAPH_API_BASE}/\${$env.GRAPH_API_VERSION}/\${id}\`, headers: { Authorization: 'Bearer ' + token }, json: true });
  if ((info.file_size ?? 0) > 10 * 1024 * 1024) continue;
  const file = await this.helpers.httpRequest({ method: 'GET', url: info.url, headers: { Authorization: 'Bearer ' + token }, encoding: 'arraybuffer' });
  media[id] = { mimeType: info.mime_type, base64: Buffer.from(file).toString('base64') };
}
return [{ json: { ...prep, media } }];`,
    ),
    960,
    0,
  );
  const brain = at(
    http("Cérebro (convexa-automacao)", {
      method: "POST",
      url: "={{ $env.AUTOMACAO_URL }}/v1/whatsapp/inbound",
      cred: CRED_AUTOMACAO,
      body: "={{ JSON.stringify({ payload: null, rawBody: $json.rawBody, signature: $json.signature, media: $json.media ?? {} }) }}",
      timeout: 45000,
    }),
    1200,
    100,
  );
  const send = at(callEnviar("Enviar respostas"), 1440, 100);
  link(c, verify.name, tokenOk.name);
  link(c, tokenOk.name, challenge.name, 0);
  link(c, tokenOk.name, deny.name, 1);
  link(c, hook.name, prep.name);
  link(c, prep.name, hasMedia.name);
  link(c, hasMedia.name, metaToken.name, 0);
  link(c, hasMedia.name, brain.name, 1);
  link(c, metaToken.name, download.name);
  link(c, download.name, brain.name);
  link(c, brain.name, send.name);
  writeFileSync(
    "workflows/2-whatsapp-entrada.json",
    JSON.stringify(workflow(ID.entrada, "Convexa · WhatsApp (entrada)", [verify, tokenOk, challenge, deny, hook, prep, hasMedia, metaToken, download, brain, send], c), null, 2),
  );
}

// =========================================================== 3. Relógio
{
  const c = {};
  const cron = at(node("A cada 5 minutos", "n8n-nodes-base.scheduleTrigger", 1.4, { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } }), 0, 0);
  const tick = at(
    http("Tarefas agendadas (lembretes, sinal vencido, resumo)", {
      method: "POST",
      url: "={{ $env.AUTOMACAO_URL }}/v1/jobs/tick",
      cred: CRED_AUTOMACAO,
      body: "{}",
      timeout: 120000,
    }),
    240,
    0,
  );
  const any = at(
    node("Tem mensagem?", "n8n-nodes-base.if", 2.4, {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 3 },
        conditions: [{ id: "b1", leftValue: "={{ ($json.batches ?? []).length }}", rightValue: 0, operator: { type: "number", operation: "gt" } }],
        combinator: "and",
      },
      looseTypeValidation: true,
      options: {},
    }),
    480,
    0,
  );
  const send = at(callEnviar("Enviar"), 720, -80);
  link(c, cron.name, tick.name);
  link(c, tick.name, any.name);
  link(c, any.name, send.name, 0);
  writeFileSync("workflows/3-relogio.json", JSON.stringify(workflow(ID.relogio, "Convexa · Relógio (lembretes e tarefas)", [cron, tick, any, send], c), null, 2));
}

// =========================================================== 4. Alexa
{
  const c = {};
  const hook = at(
    node("Pedido da Alexa", "n8n-nodes-base.webhook", 2.2, { httpMethod: "POST", path: "alexa", responseMode: "responseNode", options: { rawBody: true } }, { webhookId: "alexa" }),
    0,
    0,
  );
  const prep = at(
    code(
      "Preparar (corpo cru e assinatura)",
      `const item = $input.first();
const rawBody = item.binary?.data ? (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8') : JSON.stringify(item.json.body);
const h = item.json.headers ?? {};
return [{ json: { rawBody, signature: h['signature-256'] ?? h['signature'] ?? null, certUrl: h['signaturecertchainurl'] ?? null } }];`,
    ),
    240,
    0,
  );
  const brain = at(
    http("Cérebro (Alexa)", {
      method: "POST",
      url: "={{ $env.AUTOMACAO_URL }}/v1/alexa",
      cred: CRED_AUTOMACAO,
      body: "={{ JSON.stringify($json) }}",
      timeout: 7000,
    }),
    480,
    0,
  );
  const respond = at(node("Responder à Alexa", "n8n-nodes-base.respondToWebhook", 1.5, { respondWith: "json", responseBody: "={{ JSON.stringify($json.alexa) }}", options: {} }), 720, 0);
  const send = at(callEnviar("Enviar avisos pedidos por voz"), 960, 0);
  link(c, hook.name, prep.name);
  link(c, prep.name, brain.name);
  link(c, brain.name, respond.name);
  link(c, respond.name, send.name);
  writeFileSync("workflows/4-alexa.json", JSON.stringify(workflow(ID.alexa, "Convexa · Alexa (dono)", [hook, prep, brain, respond, send], c), null, 2));
}

// =========================================================== 5. Mercado Pago
{
  const c = {};
  const hook = at(
    node("Aviso do Mercado Pago", "n8n-nodes-base.webhook", 2.2, { httpMethod: "POST", path: "mercadopago/:businessId", responseMode: "onReceived", options: {} }, { webhookId: "mercadopago" }),
    0,
    0,
  );
  const brain = at(
    http("Cérebro (confirmar Pix)", {
      method: "POST",
      url: "={{ $env.AUTOMACAO_URL }}/v1/webhooks/mercadopago",
      cred: CRED_AUTOMACAO,
      body: "={{ JSON.stringify({ businessId: $json.params.businessId, query: $json.query, body: $json.body, signature: $json.headers['x-signature'] ?? null, requestId: $json.headers['x-request-id'] ?? null }) }}",
    }),
    240,
    0,
  );
  const send = at(callEnviar("Avisar cliente e dono"), 480, 0);
  link(c, hook.name, brain.name);
  link(c, brain.name, send.name);
  writeFileSync("workflows/5-mercadopago.json", JSON.stringify(workflow(ID.mp, "Convexa · Mercado Pago (Pix pago)", [hook, brain, send], c), null, 2));
}

console.log("workflows gerados em ./workflows");
