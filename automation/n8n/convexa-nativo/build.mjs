// Gera os workflows "Convexa - 00" a "Convexa - 17" em ./workflows (JSON para importar no n8n).
// Uso: node build.mjs
//
// Os ids e nomes dos workflows 00–14 são os mesmos do export original da equipe, então importar
// por cima atualiza os workflows que já existem no n8n (sem duplicar). As credenciais também
// usam os mesmos ids/nomes ("Convexa - Internal API Key" e "Groq account").
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ler = (f) => readFileSync(join(AQUI, "logica", f), "utf8");

export const WF = {
  WF00: "cs1xHHp13UwQIpkR",
  WF01: "FjGdfMtAM5nAZu4Q",
  WF02: "rqqKIPjaeAqEy8GW",
  WF03: "tPmuN5i2mwY8whUh",
  WF04: "3vGOPsRRUJxxJtqm",
  WF05: "teeIpYOjy1LeRaHT",
  WF06: "wHl9gupQNIMgqkid",
  WF07: "fJByu5qfUoLICkhT",
  WF08: "o5UVBX2a06p0VBGb",
  WF09: "cyESqJD5y2H5klTX",
  WF10: "u5PofWGIegW0fxr1",
  WF11: "FDRYEf2GO7QqaRU1",
  WF12: "P5jQ0lMlJKm3n4Z7",
  WF13: "1iP6wUyAgMECKreB",
  WF14: "gwRuN7kMLozuUyEf",
  WF15: "cvxIntegraMeta15",
  WF16: "cvxRegistros0016",
  WF17: "cvxInstalacao017",
};
const NOMES = {
  WF00: "Convexa - 00 Entrada de Mensagem",
  WF01: "Convexa - 01 Entendendo a mensagem",
  WF02: "Convexa - 02 Criando Agendamento",
  WF03: "Convexa - 03 Verificando Disponibilidade",
  WF04: "Convexa - 04 Reagendando Agendamento",
  WF05: "Convexa - 05 Cancelando Agendamento",
  WF06: "Convexa - 06 Informações de Agendamento",
  WF07: "Convexa - 07 Informações dos Serviços",
  WF08: "Convexa - 08 Informações do Estabelecimento",
  WF09: "Convexa - 09 Transferência para Atendente",
  WF10: "Convexa - 10 Dados do Cliente",
  WF11: "Convexa - 11 Lembrete de Agendamento",
  WF12: "Convexa - 12 Confirmação de Agendamento",
  WF13: "Convexa - 13 Pós-Agendamento",
  WF14: "Convexa - 14 Tratamento de Erros",
  WF15: "Convexa - 15 Integração Meta (envio e assinatura)",
  WF16: "Convexa - 16 Registros",
  WF17: "Convexa - 17 Instalação (rodar uma vez)",
};
const CRED_INTERNA = { httpHeaderAuth: { id: "nCSP3kSFDlY3r6RU", name: "Convexa - Internal API Key" } };
const CRED_GROQ = { groqApi: { id: "XVcRSw0hCQgad0Ii", name: "Groq account" } };
export const TABELAS = {
  conversas: ["chave", "phoneNumberId", "waId", "phone", "nome", "mode", "step", "conversa", "lastMessageId", "lastInboundAt", "sincronizadoEm"],
  agendamentos: ["appointmentId", "chave", "phoneNumberId", "waId", "phone", "nome", "servico", "profissional", "startAt", "endAt", "data", "hora", "status", "lembreteEnviado", "confirmado", "posEnviado"],
  empresas: ["phoneNumberId", "nome", "endereco", "mapsUrl", "horarios", "pagamento", "telefone", "instagram", "site", "observacoes", "telefoneAtendente"],
  envios: ["em", "phoneNumberId", "para", "tipo", "status", "metaId", "erro", "resumo", "origem"],
  erros: ["em", "tipo", "mensagem", "workflow", "node", "execucao", "url", "detalhe", "chave"],
};
const tabela = (t) => ({ __rl: true, mode: "name", value: "convexa_" + t });

// ------------------------------------------------------------------ configuração (lida do ambiente, com padrões)
// $env pode estar bloqueado (N8N_BLOCK_ENV_ACCESS_IN_NODE=true, padrão do n8n 2): aí valem os padrões.
const CFG_JS = `const __env = (k, d = "") => { try { const v = $env[k]; return v === undefined || v === null || v === "" ? d : String(v); } catch (e) { return d; } };
const cfg = {
  apiUrl: __env("CONVEXA_API_URL", "https://api-convexa.altvia.cloud").replace(/\\/+$/, ""),
  graphBase: __env("GRAPH_API_BASE", "https://graph.facebook.com").replace(/\\/+$/, ""),
  graphVersion: __env("GRAPH_API_VERSION", "v25.0"),
  verifyToken: __env("WHATSAPP_VERIFY_TOKEN", ""),
  testToken: __env("CONVEXA_TEST_TOKEN", ""),
  exigirAssinatura: __env("CONVEXA_EXIGIR_ASSINATURA", "true") !== "false",
  humanHours: Math.max(Number(__env("CONVEXA_HUMANO_HORAS", "12")) || 12, 0.25),
  reminderHours: Math.max(Number(__env("CONVEXA_LEMBRETE_HORAS", "24")) || 24, 1),
  tplLembrete: __env("CONVEXA_TEMPLATE_LEMBRETE", "convexa_lembrete"),
  tplPos: __env("CONVEXA_TEMPLATE_POS", ""),
  tplLang: __env("CONVEXA_TEMPLATE_IDIOMA", "pt_BR"),
  alertUrl: __env("CONVEXA_ALERTA_WEBHOOK_URL", ""),
  ia: __env("CONVEXA_IA", "auto"),
  wf: ${JSON.stringify(WF)},
};`;

// ------------------------------------------------------------------ helpers de node
let seq = 0;
const node = (name, type, typeVersion, parameters, pos, extra = {}) => ({
  id: `cvx-${String(++seq).padStart(4, "0")}-${name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`,
  name,
  type,
  typeVersion,
  position: pos,
  parameters,
  ...extra,
});
const code = (name, js, pos, extra = {}) => node(name, "n8n-nodes-base.code", 2, { mode: extra.porItem ? "runOnceForEachItem" : "runOnceForAllItems", language: "javaScript", jsCode: js }, pos, extra.node ?? {});
const cond = (left, op, right) => {
  const [type, operation] = op.split(".");
  return { id: `c${++seq}`, leftValue: left, rightValue: right ?? "", operator: { type, operation, ...(right === undefined ? { singleValue: true } : {}) } };
};
const se = (name, conditions, pos, combinator = "and") =>
  node(name, "n8n-nodes-base.if", 2.2, { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 }, conditions, combinator }, looseTypeValidation: true, options: {} }, pos);
const gatilhoSub = (pos) => node("When Executed by Another Workflow", "n8n-nodes-base.executeWorkflowTrigger", 1.1, { inputSource: "passthrough" }, pos);
const chamar = (name, wfKey, pos, { esperar = true, porItem = false, erroSaida = false, continuar = false, sempre = false } = {}) =>
  node(
    name,
    "n8n-nodes-base.executeWorkflow",
    1.2,
    { source: "database", workflowId: { __rl: true, mode: "list", value: WF[wfKey], cachedResultName: NOMES[wfKey], cachedResultUrl: `/workflow/${WF[wfKey]}` }, mode: porItem ? "each" : "once", options: { waitForSubWorkflow: esperar } },
    pos,
    { ...(erroSaida ? { onError: "continueErrorOutput" } : continuar ? { onError: "continueRegularOutput" } : {}), ...(sempre ? { alwaysOutputData: true } : {}) },
  );
const http = (name, { method, url, query, headers, body, batch, executeOnce, timeout = 20000 }, pos, extra = {}) =>
  node(
    name,
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method,
      url,
      authentication: extra.semCredencial ? "none" : "genericCredentialType",
      ...(extra.semCredencial ? {} : { genericAuthType: "httpHeaderAuth" }),
      ...(query ? { sendQuery: true, specifyQuery: "json", jsonQuery: query } : {}),
      ...(headers ? { sendHeaders: true, specifyHeaders: "json", jsonHeaders: headers } : {}),
      ...(body ? { sendBody: true, specifyBody: "json", jsonBody: body } : {}),
      options: { timeout, response: { response: { fullResponse: true, neverError: true } }, ...(batch ? { batching: { batch } } : {}) },
    },
    pos,
    { ...(extra.semCredencial ? {} : { credentials: CRED_INTERNA }), retryOnFail: true, maxTries: 3, waitBetweenTries: 1500, onError: "continueRegularOutput", ...(executeOnce ? { executeOnce: true } : {}) },
  );
const dt = (name, t, params, pos, extra = {}) => node(name, "n8n-nodes-base.dataTable", 1.1, { dataTableId: tabela(t), ...params }, pos, extra);
const filtro = (pares) => ({ matchType: "allConditions", filters: { conditions: pares.map(([k, v]) => ({ keyName: k, condition: "eq", keyValue: v })) } });
const dtBuscar = (name, t, pares, pos, { todos = false } = {}) =>
  dt(name, t, { resource: "row", operation: "get", ...(pares ? filtro(pares) : { matchType: "allConditions", filters: {} }), ...(todos ? { returnAll: true } : { limit: 1 }) }, pos, { alwaysOutputData: true, ...(todos ? { executeOnce: true } : {}) });
// autoMap: grava exatamente as chaves do item (que o Code anterior deixa só com colunas da tabela)
const dtUpsert = (name, t, chave, pos) => dt(name, t, { resource: "row", operation: "upsert", ...filtro([[chave, `={{ $json.${chave} }}`]]), columns: { mappingMode: "autoMapInputData", value: {}, matchingColumns: [], schema: [] }, options: {} }, pos);
const dtInserir = (name, t, pos) => dt(name, t, { resource: "row", operation: "insert", columns: { mappingMode: "autoMapInputData", value: {}, matchingColumns: [], schema: [] }, options: {} }, pos);
const noop = (name, pos) => node(name, "n8n-nodes-base.noOp", 1, {}, pos);
const responderWebhook = (name, { com = "json", corpo, status = 200 }, pos) =>
  node(name, "n8n-nodes-base.respondToWebhook", 1.4, { respondWith: com, responseBody: corpo, options: { responseCode: status } }, pos);
const ligar = (c, de, para, saida = 0, entradaIdx = 0) => {
  c[de] ??= { main: [] };
  while (c[de].main.length <= saida) c[de].main.push([]);
  c[de].main[saida].push({ node: para, type: "main", index: entradaIdx });
};
const SETTINGS = (extra = {}) => ({ executionOrder: "v1", saveManualExecutions: true, callerPolicy: "workflowsFromSameOwner", errorWorkflow: WF.WF14, ...extra });
const workflow = (k, nodes, connections, extra = {}) => ({ id: WF[k], name: NOMES[k], nodes, connections, settings: SETTINGS(extra.settings), pinData: {}, active: false, tags: [], meta: { templateCredsSetupCompleted: true } });

/** Confere a sintaxe do JS de um node Code (como o n8n roda: corpo de função async). */
function conferir(nome, js) {
  try {
    new Function("$input", "$", "$env", "$json", `return (async () => {\n${js}\n})`);
  } catch (e) {
    throw new Error(`JS inválido em "${nome}": ${e.message}`);
  }
  return js;
}

// ------------------------------------------------------------------ workflows "máquina" (Lógica ⇄ API / subworkflow)
const LIB = ler("lib.js");
const switchKind = (pos, comIA) =>
  node(
    "Próximo passo",
    "n8n-nodes-base.switch",
    3.2,
    {
      rules: {
        values: ["api", "wf", ...(comIA ? ["ai"] : [])].map((k) => ({
          conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [cond("={{ $json._next.kind }}", "string.equals", k)], combinator: "and" },
          renameOutput: true,
          outputKey: { api: "Chamar API", wf: "Chamar workflow", ai: "Perguntar à IA" }[k],
        })),
      },
      options: { fallbackOutput: "extra", renameFallbackOutput: "Pronto" },
    },
    pos,
  );

function maquina(k, arquivo, { empresa = false, ia = false } = {}) {
  const c = {};
  const nodes = [];
  const t = gatilhoSub([0, 200]);
  nodes.push(t);
  let antes = t.name;
  if (empresa) {
    const e = dtBuscar("Dados da empresa", "empresas", [["phoneNumberId", "={{ $json.phoneNumberId }}"]], [220, 200]);
    nodes.push(e);
    ligar(c, t.name, e.name);
    antes = e.name;
  }
  const entrar = code(
    "Entrar",
    conferir(
      "Entrar",
      `// Contexto da conversa que veio do workflow chamador
const ctx = JSON.parse(JSON.stringify($('When Executed by Another Workflow').first().json));
ctx.replies ??= []; ctx.events ??= []; ctx.alerts ??= [];
ctx.conversation ??= { mode: "AI", flow: null, step: "IDLE", data: {} };
${empresa ? `const linha = $input.first().json ?? {};\nctx.empresa = linha.phoneNumberId ? linha : null;` : ""}
delete ctx.result;
ctx._res = {};
ctx._voltas = 0;
ctx._snap = JSON.parse(JSON.stringify({ replies: ctx.replies, events: ctx.events, alerts: ctx.alerts, conversation: ctx.conversation }));
return [{ json: ctx }];`,
    ),
    [empresa ? 440 : 220, 200],
  );
  const logica = code(
    "Lógica",
    conferir(
      "Lógica",
      `const ctx = $input.first().json;
// cada volta recomeça do mesmo ponto (o que já foi buscado fica em ctx._res)
const __s = JSON.parse(JSON.stringify(ctx._snap));
ctx.replies = __s.replies; ctx.events = __s.events; ctx.alerts = __s.alerts; ctx.conversation = __s.conversation;
delete ctx.result; delete ctx._next;
ctx._voltas = (ctx._voltas ?? 0) + 1;
if (ctx._voltas > 40) throw new Error("Lógica: chamadas demais para uma mensagem");
${LIB}
try {
  (function principal() {
${ler(arquivo)}
  })();
  ctx._next = { kind: "fim" };
} catch (e) {
  if (e !== PENDENTE) throw e;
}
return [{ json: ctx }];`,
    ),
    [entrar.position[0] + 240, 200],
  );
  const x = logica.position[0];
  const sw = switchKind([x + 240, 200], ia);
  const api = http(
    "Chamar API",
    {
      method: "={{ $json._next.method }}",
      url: "={{ $json._next.url }}",
      query: "={{ JSON.stringify($json._next.query ?? {}) }}",
      headers: "={{ JSON.stringify($json._next.token ? { Authorization: 'Bearer ' + $json._next.token } : {}) }}",
      body: "={{ JSON.stringify($json._next.body ?? {}) }}",
    },
    [x + 520, 0],
  );
  const guardar = code(
    "Guardar resposta",
    conferir(
      "Guardar resposta",
      `const ctx = $('Lógica').first().json;
const r = $input.first().json ?? {};
let status = Number(r.statusCode ?? 0);
let body = r.body ?? null;
let erro = null;
if (r.error) {
  erro = typeof r.error === "string" ? r.error : r.error.message ?? JSON.stringify(r.error).slice(0, 300);
  status = Number(r.error.httpCode ?? r.error.status ?? 0) || 0;
}
if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) {} }
ctx._res[ctx._next.key] = { status, body, erro };
delete ctx._next;
return [{ json: ctx }];`,
    ),
    [x + 760, 0],
  );
  const prep = code(
    "Preparar chamada",
    conferir(
      "Preparar chamada",
      `const c = $input.first().json;
const { _res, _snap, _next, _voltas, input, result, ...resto } = c;
return [{ json: { ...resto, replies: [], events: [], alerts: [], input: _next.input ?? {} } }];`,
    ),
    [x + 520, 200],
  );
  const exec = node(
    "Chamar workflow",
    "n8n-nodes-base.executeWorkflow",
    1.2,
    { source: "database", workflowId: { __rl: true, mode: "id", value: "={{ $('Lógica').first().json._next.workflowId }}" }, mode: "once", options: { waitForSubWorkflow: true } },
    [x + 760, 200],
  );
  const retorno = code(
    "Guardar retorno",
    conferir(
      "Guardar retorno",
      `const ctx = $('Lógica').first().json;
const out = $input.first().json ?? {};
ctx._res[ctx._next.key] = { ctx: { replies: out.replies ?? [], events: out.events ?? [], alerts: out.alerts ?? [], conversation: out.conversation ?? null, result: out.result ?? null } };
delete ctx._next;
return [{ json: ctx }];`,
    ),
    [x + 1000, 200],
  );
  const sair = code(
    "Sair",
    conferir(
      "Sair",
      `const c = $input.first().json;
const { _res, _snap, _next, _voltas, input, ...resto } = c;
return [{ json: resto }];`,
    ),
    [x + 520, 600],
  );
  nodes.push(entrar, logica, sw, api, guardar, prep, exec, retorno, sair);
  ligar(c, antes, entrar.name);
  ligar(c, entrar.name, logica.name);
  ligar(c, logica.name, sw.name);
  ligar(c, sw.name, api.name, 0);
  ligar(c, sw.name, prep.name, 1);
  ligar(c, api.name, guardar.name);
  ligar(c, guardar.name, logica.name);
  ligar(c, prep.name, exec.name);
  ligar(c, exec.name, retorno.name);
  ligar(c, retorno.name, logica.name);
  if (ia) {
    // Groq pela API compatível com OpenAI, com tempo-limite curto: se a IA estiver fora, o cliente
    // não espera (o node de IA do LangChain repete por minutos). Usa a credencial "Groq account".
    const PROMPT = `Você classifica mensagens de clientes de um negócio de agendamento (barbearia, salão, clínica etc.). Responda SOMENTE com um JSON, sem texto antes ou depois, no formato: {"intencao": "AGENDAR|CONSULTAR|REMARCAR|CANCELAR|SERVICOS|ESTABELECIMENTO|ATENDENTE|SAUDACAO|AGRADECIMENTO|OUTRO", "servico": "nome do serviço citado ou null", "data": "dia citado como o cliente escreveu ou null", "horario": "horário citado ou null"}. Não invente serviços, datas ou horários que não estejam na mensagem.`;
    const pedir = node(
      "Classificar com IA (Groq)",
      "n8n-nodes-base.httpRequest",
      4.2,
      {
        method: "POST",
        url: "https://api.groq.com/openai/v1/chat/completions",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "groqApi",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={{ JSON.stringify({ model: "openai/gpt-oss-20b", temperature: 0, max_tokens: 600, reasoning_effort: "low", messages: [{ role: "system", content: ${JSON.stringify(PROMPT)} + " Hoje é " + $json._next.hoje + "." }, { role: "user", content: $json._next.texto }] }) }}`,
        options: { timeout: 8000, response: { response: { fullResponse: true, neverError: true } } },
      },
      [x + 520, 400],
      { credentials: CRED_GROQ, onError: "continueRegularOutput" },
    );
    const lerIa = code(
      "Guardar IA",
      conferir(
        "Guardar IA",
        `const ctx = $('Lógica').first().json;
const r = $input.first().json ?? {};
let out = null;
const texto = String(r.body?.choices?.[0]?.message?.content ?? "");
const m = texto.match(/\\{[\\s\\S]*\\}/);
if (m) { try { out = JSON.parse(m[0]); } catch (e) { out = null; } }
const validas = ["AGENDAR","CONSULTAR","REMARCAR","CANCELAR","SERVICOS","ESTABELECIMENTO","ATENDENTE","SAUDACAO","AGRADECIMENTO","OUTRO"];
if (!out || !validas.includes(String(out.intencao).toUpperCase())) out = { intencao: null, falhou: true, status: r.statusCode ?? 0, erro: r.error ? String(r.error.message ?? r.error).slice(0, 200) : String(r.body?.error?.message ?? "").slice(0, 200) };
else out.intencao = String(out.intencao).toUpperCase();
for (const k of ["servico", "data", "horario"]) if (out[k] === "null" || out[k] === "") out[k] = null;
ctx._res[ctx._next.key] = out;
delete ctx._next;
return [{ json: ctx }];`,
      ),
      [x + 760, 400],
    );
    nodes.push(pedir, lerIa);
    ligar(c, sw.name, pedir.name, 2);
    ligar(c, pedir.name, lerIa.name);
    ligar(c, lerIa.name, logica.name);
    ligar(c, sw.name, sair.name, 3);
  } else ligar(c, sw.name, sair.name, 2);
  return workflow(k, nodes, c);
}

// ------------------------------------------------------------------ WF00 Entrada de Mensagem
function wf00() {
  const c = {};
  const N = [];
  const add = (...n) => (N.push(...n), n[0]);
  const hook = add(node("Webhook", "n8n-nodes-base.webhook", 2.1, { httpMethod: "POST", path: "convexa/message", responseMode: "responseNode", options: { rawBody: true } }, [0, 300], { webhookId: "8a920519-6b18-4d5b-8828-a2c19ee00b13" }));
  // verificação do webhook pela Meta (GET com hub.challenge)
  const get = add(node("Webhook (verificação da Meta)", "n8n-nodes-base.webhook", 2.1, { httpMethod: "GET", path: "convexa/message", responseMode: "responseNode", options: {} }, [0, 0], { webhookId: "6f1c2d0e-3b7a-4c55-9e0a-0c0b6e7a1f15" }));
  const confTok = add(
    code(
      "Conferir token de verificação",
      conferir("tok", `${CFG_JS}\nconst q = $input.first().json.query ?? {};\nconst ok = !!cfg.verifyToken && q["hub.mode"] === "subscribe" && q["hub.verify_token"] === cfg.verifyToken;\nreturn [{ json: { ok, challenge: String(q["hub.challenge"] ?? "") } }];`),
      [220, 0],
    ),
  );
  const tokOk = add(se("Token confere?", [cond("={{ $json.ok }}", "boolean.true")], [440, 0]));
  const desafio = add(responderWebhook("Devolver desafio", { com: "text", corpo: "={{ $json.challenge }}" }, [660, -80]));
  const recusaGet = add(responderWebhook("Recusar verificação", { com: "text", corpo: "token de verificação inválido", status: 403 }, [660, 80]));
  ligar(c, get.name, confTok.name);
  ligar(c, confTok.name, tokOk.name);
  ligar(c, tokOk.name, desafio.name, 0);
  ligar(c, tokOk.name, recusaGet.name, 1);

  const lerReq = add(
    code(
      "Ler requisição",
      conferir(
        "ler",
        `${CFG_JS}
// Corpo exatamente como chegou (a assinatura da Meta é calculada sobre ele)
const item = $input.first();
let raw = "";
try { if (item.binary?.data) raw = (await this.helpers.getBinaryDataBuffer(0, "data")).toString("utf8"); } catch (e) { raw = ""; }
const h = item.json.headers ?? {};
let body = item.json.body;
if (!raw) raw = JSON.stringify(body ?? {});
if (!body || typeof body !== "object" || !Object.keys(body).length) { try { body = JSON.parse(raw); } catch (e) { body = {}; } }
const meta = body?.object === "whatsapp_business_account" || Array.isArray(body?.entry);
const phoneNumberId = meta ? body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null : body.phoneNumberId ?? null;
return [{ json: { acao: "validar", cfg, origem: meta ? "meta" : "teste", rawBody: raw, assinatura: String(h["x-hub-signature-256"] ?? ""), autorizacao: String(h["authorization"] ?? ""), phoneNumberId, body } }];`,
      ),
      [220, 300],
    ),
  );
  const daMeta = add(se("Veio da Meta?", [cond("={{ $json.origem }}", "string.equals", "meta")], [440, 300]));
  const validar = add(chamar("Call 'Convexa - 15 Integração Meta' (assinatura)", "WF15", [660, 220], { continuar: true }));
  const validarTeste = add(
    code(
      "Validar token de teste",
      conferir("vt", `const j = $input.first().json;\nconst ok = !!j.cfg.testToken && j.autorizacao === "Bearer " + j.cfg.testToken;\nreturn [{ json: { valida: ok, motivo: ok ? "ok" : j.cfg.testToken ? "token_de_teste_invalido" : "testes_desligados" } }];`),
      [660, 400],
    ),
  );
  const autorizada = add(se("API Autorizada?", [cond("={{ $json.valida }}", "boolean.true")], [880, 300]));
  const recusa = add(responderWebhook("Respond 401", { corpo: '={{ JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", motivo: $json.motivo ?? "assinatura_invalida" } }) }}', status: 401 }, [1100, 480]));
  const recusaConfig = add(se("Recusa por configuração?", [cond("={{ ['sem_integracao','sem_app_secret','api_indisponivel'].includes($json.motivo) }}", "boolean.true")], [1320, 480]));
  const alertaRecusa = add(
    code(
      "Alerta de configuração",
      conferir(
        "ar",
        `const j = $('API Autorizada?').first().json;
const req = $('Ler requisição').first().json;
const textos = { sem_integracao: "O número da Meta não tem integração cadastrada no painel (token da Meta).", sem_app_secret: "A integração da Meta está sem App Secret no painel: não dá para conferir a assinatura dos webhooks.", api_indisponivel: "A ConvexaAPI não respondeu ao conferir a assinatura do webhook." };
return [{ json: { tipo: "WEBHOOK_RECUSADO", mensagem: (textos[j.motivo] ?? j.motivo) + " phoneNumberId=" + (req.phoneNumberId ?? "?"), detalhe: { motivo: j.motivo, phoneNumberId: req.phoneNumberId }, chave: "RECUSA:" + j.motivo + ":" + (req.phoneNumberId ?? "") + ":" + new Date().toISOString().slice(0, 13), origem: "WF00" } }];`,
      ),
      [1540, 480],
    ),
  );
  const alertaWf14 = add(chamar("Call 'Convexa - 14 Tratamento de Erros'", "WF14", [1760, 480], { esperar: false, continuar: true }));
  const meta200 = add(se("Responder já?", [cond("={{ $('Ler requisição').first().json.origem }}", "string.equals", "meta")], [1100, 220]));
  const resp200 = add(responderWebhook("Responder à Meta", { com: "text", corpo: "EVENT_RECEIVED" }, [1320, 140]));
  ligar(c, hook.name, lerReq.name);
  ligar(c, lerReq.name, daMeta.name);
  ligar(c, daMeta.name, validar.name, 0);
  ligar(c, daMeta.name, validarTeste.name, 1);
  ligar(c, validar.name, autorizada.name);
  ligar(c, validarTeste.name, autorizada.name);
  ligar(c, autorizada.name, meta200.name, 0);
  ligar(c, autorizada.name, recusa.name, 1);
  ligar(c, recusa.name, recusaConfig.name);
  ligar(c, recusaConfig.name, alertaRecusa.name, 0);
  ligar(c, alertaRecusa.name, alertaWf14.name);

  const normaliza = add(code("Normaliza Texto", conferir("norm", ler("wf00-normaliza.js")), [1540, 300]));
  ligar(c, meta200.name, resp200.name, 0);
  ligar(c, resp200.name, normaliza.name);
  ligar(c, meta200.name, normaliza.name, 1);

  const loop = add(node("Uma mensagem por vez", "n8n-nodes-base.splitInBatches", 3, { batchSize: 1, options: {} }, [1760, 300]));
  ligar(c, normaliza.name, loop.name);
  const carregar = add(dtBuscar("Carregar conversa", "conversas", [["chave", "={{ $json.phoneNumberId + ':' + $json.phone }}"]], [1980, 380]));
  ligar(c, loop.name, carregar.name, 1);
  const montar = add(code("Montar contexto", conferir("mc", ler("wf00-contexto.js")), [2200, 380]));
  ligar(c, carregar.name, montar.name);
  const nova = add(se("Mensagem nova?", [cond("={{ $json.duplicada }}", "boolean.false")], [2420, 380]));
  ligar(c, montar.name, nova.name);
  const proxima = add(noop("Próxima mensagem", [5000, 700]));
  ligar(c, nova.name, proxima.name, 1);
  const wf10 = add(chamar("Call 'Convexa - 10 Dados do Cliente'", "WF10", [2640, 300], { erroSaida: true }));
  ligar(c, nova.name, wf10.name, 0);
  const seguir = add(se("Seguir conversa?", [cond("={{ $json.result?.parar === true }}", "boolean.false")], [2860, 300]));
  ligar(c, wf10.name, seguir.name, 0);
  const atendente = add(se("Convexa ou Atendente?", [cond("={{ $json.conversation.mode }}", "string.equals", "HUMAN")], [3080, 220]));
  ligar(c, seguir.name, atendente.name, 0);

  const ROTAS = [
    ["WAITING_CUSTOMER_NAME", "WF10"],
    ["WAITING_SERVICE", "WF02"],
    ["WAITING_DATE", "WF02"],
    ["WAITING_TIME", "WF02"],
    ["WAITING_APPOINTMENT_CONFIRMATION", "WF02"],
    ["WAITING_APPOINTMENT_SELECTION", "WF06"],
    ["WAITING_RESCHEDULE_DATE", "WF04"],
    ["WAITING_RESCHEDULE_TIME", "WF04"],
    ["WAITING_RESCHEDULE_CONFIRMATION", "WF04"],
    ["WAITING_CANCEL_SELECTION", "WF05"],
    ["WAITING_CANCEL_CONFIRMATION", "WF05"],
    ["WAITING_APPOINTMENT_CONFIRMATION_REPLY", "WF12"],
  ];
  const sw = add(
    node(
      "Switch",
      "n8n-nodes-base.switch",
      3.2,
      {
        rules: {
          values: ROTAS.map(([step]) => ({
            conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [cond("={{ $json.conversation.step }}", "string.equals", step)], combinator: "and" },
            renameOutput: true,
            outputKey: step,
          })),
        },
        options: { fallbackOutput: "extra", renameFallbackOutput: "Outros (IDLE)" },
      },
      [3300, 400],
    ),
  );
  ligar(c, atendente.name, sw.name, 1);
  const resultado = add(code("Resultado", conferir("res", `const ctx = $input.first().json;\nctx.replies ??= []; ctx.events ??= []; ctx.alerts ??= [];\nreturn [{ json: ctx }];`), [4120, 400]));
  const linhaConv = add(code("Linha da conversa", conferir("lc", ler("wf00-resultado.js")), [4340, 560]));
  const falha = add(code("Falha no fluxo", conferir("falha", ler("wf00-falha.js")), [3900, 1000]));
  const destinos = {};
  const y0 = 0;
  // o passo WAITING_CUSTOMER_NAME já foi tratado pelo WF10 (que roda antes de tudo): aqui segue ao WF01
  const alvoDe = (k) => (k === "WF10" ? "WF01" : k);
  [...new Set([...ROTAS.map(([, k]) => alvoDe(k)), "WF01"])].forEach((k, i) => {
    destinos[k] = add(chamar(`Call '${NOMES[k]}'`, k, [3720, y0 + i * 160], { erroSaida: true }));
    ligar(c, destinos[k].name, resultado.name, 0);
    ligar(c, destinos[k].name, falha.name, 1);
  });
  ROTAS.forEach(([, k], i) => ligar(c, sw.name, destinos[alvoDe(k)].name, i));
  ligar(c, sw.name, destinos.WF01.name, ROTAS.length);
  const wf09 = add(chamar(`Call '${NOMES.WF09}'`, "WF09", [3720, -200], { erroSaida: true }));
  ligar(c, atendente.name, wf09.name, 0);
  ligar(c, wf09.name, resultado.name, 0);
  ligar(c, wf09.name, falha.name, 1);
  ligar(c, wf10.name, falha.name, 1);
  ligar(c, seguir.name, resultado.name, 1);
  ligar(c, falha.name, resultado.name);

  const salvar = add(dtUpsert("Salvar conversa", "conversas", "chave", [4340, 400]));
  ligar(c, resultado.name, linhaConv.name);
  ligar(c, linhaConv.name, salvar.name);
  const prepEnvio = add(
    code(
      "Preparar envio",
      conferir(
        "pe",
        `const r = $('Resultado').first().json;
const req = $('Ler requisição').first().json;
const simular = r.origem === "teste" && req.body?.enviar !== true;
return [{ json: { acao: "enviar", cfg: r.cfg, origem: r.origem, simular, phoneNumberId: r.phoneNumberId, waId: r.waId, replies: r.replies ?? [] } }];`,
      ),
      [4560, 400],
    ),
  );
  ligar(c, salvar.name, prepEnvio.name);
  const enviar = add(chamar("Call 'Convexa - 15 Integração Meta' (enviar)", "WF15", [4780, 400], { continuar: true, sempre: true }));
  ligar(c, prepEnvio.name, enviar.name);
  const prepReg = add(
    code(
      "Preparar registros",
      conferir(
        "pr",
        `const r = $('Resultado').first().json;
return [{ json: { cfg: r.cfg, phoneNumberId: r.phoneNumberId, waId: r.waId, phone: r.phone, nome: r.session?.customer?.name ?? r.profileName ?? "", events: r.events ?? [], alerts: r.alerts ?? [], envio: $input.first().json ?? {} } }];`,
      ),
      [5000, 400],
    ),
  );
  ligar(c, enviar.name, prepReg.name);
  const registrar = add(chamar("Call 'Convexa - 16 Registros'", "WF16", [5220, 400], { continuar: true, sempre: true }));
  ligar(c, prepReg.name, registrar.name);
  ligar(c, registrar.name, proxima.name);
  ligar(c, proxima.name, loop.name);

  // fim do laço: nos testes (sem Meta) devolve as respostas na própria requisição
  const eraTeste = add(se("Era teste?", [cond("={{ $('Ler requisição').first().json.origem }}", "string.equals", "teste")], [1980, 120]));
  ligar(c, loop.name, eraTeste.name, 0);
  const resumo = add(
    code(
      "Resumo do teste",
      conferir(
        "rt",
        `let r = null;
try { r = $('Resultado').first().json; } catch (e) { r = null; }
if (!r) return [{ json: { success: true, duplicada: true, replies: [] } }];
return [{ json: { success: true, replies: r.replies ?? [], conversation: { mode: r.conversation?.mode, flow: r.conversation?.flow, step: r.conversation?.step }, events: r.events ?? [], alerts: (r.alerts ?? []).map((a) => a.tipo) } }];`,
      ),
      [2200, 120],
    ),
  );
  ligar(c, eraTeste.name, resumo.name, 0);
  const respTeste = add(responderWebhook("Respond to Webhook1", { corpo: "={{ JSON.stringify($json) }}" }, [2420, 120]));
  ligar(c, resumo.name, respTeste.name);
  return workflow("WF00", N, c);
}

// ------------------------------------------------------------------ WF11 Lembrete e WF13 Pós-agendamento
function agendado(k, { titulo, minutos, caminho }) {
  const c = {};
  const N = [];
  const add = (n) => (N.push(n), n);
  const relogio = add(node(titulo, "n8n-nodes-base.scheduleTrigger", 1.2, { rule: { interval: [{ field: "minutes", minutesInterval: minutos }] } }, [0, 200]));
  const manual = add(gatilhoSub([0, 400]));
  // rodar agora (operação e testes): POST /webhook/convexa/<caminho> com o header x-internal-key
  const agora = add(
    node("Rodar agora (webhook)", "n8n-nodes-base.webhook", 2.1, { httpMethod: "POST", path: "convexa/" + caminho, authentication: "headerAuth", responseMode: "onReceived", options: {} }, [0, 600], { webhookId: `c0e1b2a3-4d5e-4f60-8a71-${k === "WF11" ? "9b2c3d4e5f11" : "9b2c3d4e5f13"}`, credentials: CRED_INTERNA }),
  );
  const config = add(code("Config", conferir("cfg", `${CFG_JS}\nreturn [{ json: { cfg } }];`), [220, 300]));
  ligar(c, relogio.name, config.name);
  ligar(c, manual.name, config.name);
  ligar(c, agora.name, config.name);
  const convs = add(dtBuscar("Conversas", "conversas", null, [440, 300], { todos: true }));
  const ags = add(dtBuscar("Agendamentos", "agendamentos", null, [660, 300], { todos: true }));
  ligar(c, config.name, convs.name);
  ligar(c, convs.name, ags.name);
  return { c, N, add, ags };
}

function wf11() {
  const { c, N, add, ags } = agendado("WF11", { titulo: "A cada 15 minutos", minutos: 15, caminho: "lembretes" });
  const quem = add(code("Clientes a verificar", conferir("cv", ler("wf11-clientes.js")), [880, 300]));
  ligar(c, ags.name, quem.name);
  const sessao = add(
    http(
      "Abrir sessão",
      { method: "POST", url: "={{ $json.cfg.apiUrl }}/internal/conversation/session", body: "={{ JSON.stringify({ phoneNumberId: $json.phoneNumberId, phone: $json.phone }) }}", batch: { batchSize: 5, batchInterval: 1000 } },
      [1100, 300],
    ),
  );
  ligar(c, quem.name, sessao.name);
  const listar = add(
    http(
      "Listar agendamentos do cliente",
      { method: "GET", url: "={{ $('Clientes a verificar').item.json.cfg.apiUrl }}/internal/conversation/appointments", headers: "={{ JSON.stringify({ Authorization: 'Bearer ' + ($json.body?.token ?? 'sem-sessao') }) }}", batch: { batchSize: 5, batchInterval: 1000 } },
      [1320, 300],
    ),
  );
  ligar(c, sessao.name, listar.name);
  const rec = add(code("Reconciliar e montar lembretes", conferir("rec", ler("wf11-reconciliar.js")), [1540, 300]));
  ligar(c, listar.name, rec.name);
  return finalizarAgendado("WF11", c, N, add, rec);
}
function wf13() {
  const { c, N, add, ags } = agendado("WF13", { titulo: "A cada hora", minutos: 60, caminho: "pos-atendimento" });
  const pos = add(code("Atendimentos concluídos", conferir("pos", ler("wf13-pos.js")), [880, 300]));
  ligar(c, ags.name, pos.name);
  return finalizarAgendado("WF13", c, N, add, pos);
}
/** Saída comum: itens com `tipo` = agendamento | conversa | sincronizado | envio. */
function finalizarAgendado(k, c, N, add, fonte) {
  const x = fonte.position[0];
  const sw = add(
    node(
      "Tipo",
      "n8n-nodes-base.switch",
      3.2,
      {
        rules: {
          values: ["agendamento", "conversa", "envio"].map((t) => ({
            conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [cond("={{ $json.tipo }}", "string.equals", t)], combinator: "and" },
            renameOutput: true,
            outputKey: t,
          })),
        },
        options: {},
      },
      [x + 220, 300],
    ),
  );
  ligar(c, fonte.name, sw.name);
  const limpa = (name, pos) => add(code(name, conferir(name, `return $input.all().map((i) => ({ json: i.json.linha }));`), pos));
  const l1 = limpa("Linha do agendamento", [x + 440, 120]);
  const u1 = add(dtUpsert("Salvar agendamento", "agendamentos", "appointmentId", [x + 660, 120]));
  const l2 = limpa("Linha da conversa", [x + 440, 300]);
  const u2 = add(dtUpsert("Atualizar conversa", "conversas", "chave", [x + 660, 300]));
  const env = add(chamar("Call 'Convexa - 15 Integração Meta' (enviar)", "WF15", [x + 440, 480], { porItem: true, continuar: true }));
  ligar(c, sw.name, l1.name, 0);
  ligar(c, l1.name, u1.name);
  ligar(c, sw.name, l2.name, 1);
  ligar(c, l2.name, u2.name);
  ligar(c, sw.name, env.name, 2);
  return workflow(k, N, c);
}

// ------------------------------------------------------------------ WF14 Tratamento de Erros
function wf14() {
  const c = {};
  const N = [];
  const add = (n) => (N.push(n), n);
  const erro = add(node("Quando um workflow falhar", "n8n-nodes-base.errorTrigger", 1, {}, [0, 120]));
  const sub = add(gatilhoSub([0, 320]));
  const montar = add(code("Montar registro", conferir("mr", `${CFG_JS}\n${ler("wf14-registro.js")}`), [220, 220]));
  ligar(c, erro.name, montar.name);
  ligar(c, sub.name, montar.name);
  const novo = add(dt("Ainda não registrado?", "erros", { resource: "row", operation: "rowNotExists", ...filtro([["chave", "={{ $json.linha.chave }}"]]) }, [440, 220]));
  ligar(c, montar.name, novo.name);
  const linha = add(code("Linha do erro", conferir("le", `return $input.all().map((i) => ({ json: i.json.linha }));`), [660, 140]));
  const ins = add(dtInserir("Registrar", "erros", [880, 140]));
  ligar(c, novo.name, linha.name);
  ligar(c, linha.name, ins.name);
  const temUrl = add(se("Tem webhook de alerta?", [cond("={{ !!$json.cfg.alertUrl }}", "boolean.true")], [660, 320]));
  ligar(c, novo.name, temUrl.name);
  const avisar = add(
    http(
      "Avisar a equipe",
      { method: "POST", url: "={{ $json.cfg.alertUrl }}", body: "={{ JSON.stringify({ text: $json.texto, content: $json.texto, tipo: $json.linha.tipo, mensagem: $json.linha.mensagem, workflow: $json.linha.workflow, execucao: $json.linha.url || $json.linha.execucao, em: $json.linha.em }) }}" },
      [880, 320],
      { semCredencial: true },
    ),
  );
  ligar(c, temUrl.name, avisar.name, 0);
  // o próprio tratamento de erros não pode ter errorWorkflow (evita laço)
  const w = workflow("WF14", N, c);
  delete w.settings.errorWorkflow;
  return w;
}

// ------------------------------------------------------------------ WF15 Integração Meta (sem salvar execuções: tem token da Meta)
function wf15() {
  const c = {};
  const N = [];
  const add = (n) => (N.push(n), n);
  const t = add(gatilhoSub([0, 300]));
  const cred = add(
    http("Buscar credenciais da Meta", { method: "GET", url: "={{ $json.cfg.apiUrl }}/internal/integrations/by-phone-number-id/{{ encodeURIComponent($json.phoneNumberId ?? '') }}", executeOnce: true }, [220, 300]),
  );
  ligar(c, t.name, cred.name);
  const acao = add(se("Validar assinatura?", [cond("={{ $('When Executed by Another Workflow').first().json.acao }}", "string.equals", "validar")], [440, 300]));
  ligar(c, cred.name, acao.name);
  const hmac = add(
    node(
      "Calcular assinatura",
      "n8n-nodes-base.crypto",
      1,
      { action: "hmac", type: "SHA256", value: "={{ $('When Executed by Another Workflow').first().json.rawBody }}", secret: "={{ $json.body?.metaAppSecret || 'sem-app-secret' }}", dataPropertyName: "assinaturaCalculada", encoding: "hex" },
      [660, 160],
    ),
  );
  ligar(c, acao.name, hmac.name, 0);
  const resVal = add(
    code(
      "Resultado da validação",
      conferir(
        "rv",
        `const inp = $('When Executed by Another Workflow').first().json;
const cred = $('Buscar credenciais da Meta').first().json ?? {};
const st = Number(cred.statusCode ?? 0);
if (st === 404) return [{ json: { valida: false, motivo: "sem_integracao" } }];
if (!(st >= 200 && st < 300)) return [{ json: { valida: false, motivo: "api_indisponivel", status: st } }];
if (!cred.body?.metaAppSecret) return [{ json: { valida: !inp.cfg.exigirAssinatura, motivo: inp.cfg.exigirAssinatura ? "sem_app_secret" : "sem_app_secret_aceito" } }];
const calc = String($input.first().json.assinaturaCalculada ?? "");
const valida = inp.assinatura.length > 7 && inp.assinatura === "sha256=" + calc;
return [{ json: { valida, motivo: valida ? "ok" : "assinatura_invalida" } }];`,
      ),
      [880, 160],
    ),
  );
  ligar(c, hmac.name, resVal.name);
  const montar = add(code("Montar mensagens", conferir("mm", ler("wf15-montar.js")), [660, 440]));
  ligar(c, acao.name, montar.name, 1);
  const pode = add(se("Pode enviar?", [cond("={{ !!$json.graph }}", "boolean.true")], [880, 440]));
  ligar(c, montar.name, pode.name);
  const cota = add(
    http(
      "Consumir cota",
      { method: "POST", url: "={{ $json.cfg.apiUrl }}/internal/messages/quota", body: "={{ JSON.stringify({ phoneNumberId: $json.phoneNumberId, count: 1 }) }}", batch: { batchSize: 1, batchInterval: 0 } },
      [1100, 360],
    ),
  );
  ligar(c, pode.name, cota.name, 0);
  const dentro = add(se("Dentro da cota?", [cond("={{ $json.statusCode }}", "number.lt", 300), cond("={{ $json.statusCode }}", "number.gte", 200)], [1320, 360]));
  ligar(c, cota.name, dentro.name);
  const envia = add(
    http(
      "Enviar pela Meta",
      {
        method: "POST",
        url: "={{ $('Montar mensagens').item.json.cfg.graphBase }}/{{ $('Montar mensagens').item.json.cfg.graphVersion }}/{{ $('Montar mensagens').item.json.phoneNumberId }}/messages",
        headers: "={{ JSON.stringify({ Authorization: 'Bearer ' + $('Buscar credenciais da Meta').first().json.body.metaAccessToken }) }}",
        body: "={{ JSON.stringify($('Montar mensagens').item.json.graph) }}",
        // uma por vez, com intervalo: a Meta não garante a ordem de mensagens disparadas juntas
        batch: { batchSize: 1, batchInterval: 400 },
      },
      [1540, 280],
      { semCredencial: true },
    ),
  );
  ligar(c, dentro.name, envia.name, 0);
  const resEnvio = add(code("Resultado do envio", conferir("re", ler("wf15-resultado.js")), [1760, 280], { porItem: true }));
  ligar(c, envia.name, resEnvio.name);
  const semCota = add(
    code(
      "Cota esgotada",
      conferir(
        "ce",
        `const m = $('Montar mensagens').item.json;
const r = $input.item.json;
return { json: { linha: { em: new Date().toISOString(), phoneNumberId: m.phoneNumberId, para: m.to, tipo: m.tipo, status: r.statusCode === 402 ? "COTA_ESGOTADA" : "COTA_FALHOU", metaId: "", erro: String(r.body?.message ?? r.error?.message ?? r.statusCode ?? "").slice(0, 300), resumo: m.resumo, origem: m.origem }, alerta: { tipo: r.statusCode === 402 ? "COTA_ESGOTADA" : "COTA_FALHOU", mensagem: r.statusCode === 402 ? "Limite mensal de mensagens atingido: o bot parou de responder. Aumente o limite no painel." : "Não foi possível consumir a cota de mensagens (API fora?).", detalhe: { phoneNumberId: m.phoneNumberId, status: r.statusCode }, chave: "COTA:" + m.phoneNumberId + ":" + new Date().toISOString().slice(0, 10), origem: "WF15" } } };`,
      ),
      [1540, 460],
      { porItem: true },
    ),
  );
  ligar(c, dentro.name, semCota.name, 1);
  const semEnvio = add(code("Sem envio", conferir("se", `return $input.all().filter((i) => i.json.linha).map((i) => ({ json: i.json }));`), [1100, 560]));
  ligar(c, pode.name, semEnvio.name, 1);
  const juntar = add(code("Linha do envio", conferir("lin", `return $input.all().map((i) => ({ json: i.json.linha }));`), [1980, 400]));
  const registrar = add(dtInserir("Registrar envio", "envios", [2200, 400]));
  ligar(c, resEnvio.name, juntar.name);
  ligar(c, semCota.name, juntar.name);
  ligar(c, semEnvio.name, juntar.name);
  ligar(c, juntar.name, registrar.name);
  const alertas = add(code("Alertas do envio", conferir("ae", `return $input.all().filter((i) => i.json.alerta).map((i) => ({ json: i.json.alerta }));`), [1980, 600]));
  ligar(c, resEnvio.name, alertas.name);
  ligar(c, semCota.name, alertas.name);
  ligar(c, semEnvio.name, alertas.name);
  const wf14 = add(chamar("Call 'Convexa - 14 Tratamento de Erros'", "WF14", [2200, 600], { porItem: true, esperar: false, continuar: true }));
  ligar(c, alertas.name, wf14.name);
  return workflow("WF15", N, c, { settings: { saveDataSuccessExecution: "none", saveDataErrorExecution: "none", saveManualExecutions: false, saveExecutionProgress: false } });
}

// ------------------------------------------------------------------ WF16 Registros (agendamentos e alertas)
function wf16() {
  const c = {};
  const N = [];
  const add = (n) => (N.push(n), n);
  const t = add(gatilhoSub([0, 300]));
  const sep = add(code("Separar registros", conferir("sr", ler("wf16-separar.js")), [220, 300]));
  ligar(c, t.name, sep.name);
  const sw = add(
    node(
      "Tipo",
      "n8n-nodes-base.switch",
      3.2,
      {
        rules: {
          values: ["agendamento", "alerta"].map((k) => ({
            conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [cond("={{ $json.tipo }}", "string.equals", k)], combinator: "and" },
            renameOutput: true,
            outputKey: k,
          })),
        },
        options: {},
      },
      [440, 300],
    ),
  );
  ligar(c, sep.name, sw.name);
  const linha = add(code("Linha do agendamento", conferir("la", `return $input.all().map((i) => ({ json: i.json.linha }));`), [660, 200]));
  const up = add(dtUpsert("Salvar agendamento", "agendamentos", "appointmentId", [880, 200]));
  ligar(c, sw.name, linha.name, 0);
  ligar(c, linha.name, up.name);
  const al = add(code("Dados do alerta", conferir("da", `return $input.all().map((i) => ({ json: i.json.alerta }));`), [660, 400]));
  const wf14 = add(chamar("Call 'Convexa - 14 Tratamento de Erros'", "WF14", [880, 400], { porItem: true, esperar: false, continuar: true }));
  ligar(c, sw.name, al.name, 1);
  ligar(c, al.name, wf14.name);
  return workflow("WF16", N, c);
}

// ------------------------------------------------------------------ WF17 Instalação: cria as tabelas (Data tables) do n8n
function wf17() {
  const c = {};
  const N = [];
  const add = (n) => (N.push(n), n);
  const t = add(node("Rodar instalação", "n8n-nodes-base.manualTrigger", 1, {}, [0, 200]));
  // também por webhook (o setup.sh usa): exige o header x-internal-key, a mesma credencial da API
  const w = add(
    node("Instalar por webhook", "n8n-nodes-base.webhook", 2.1, { httpMethod: "POST", path: "convexa/instalar", authentication: "headerAuth", responseMode: "lastNode", options: {} }, [0, 400], { webhookId: "c0e1b2a3-4d5e-4f60-8a71-9b2c3d4e5f17", credentials: CRED_INTERNA }),
  );
  const juntar = add(noop("Começar", [110, 300]));
  ligar(c, t.name, juntar.name);
  ligar(c, w.name, juntar.name);
  let antes = juntar.name;
  Object.entries(TABELAS).forEach(([nome, colunas], i) => {
    const n = add(
      node(
        `Criar convexa_${nome}`,
        "n8n-nodes-base.dataTable",
        1.1,
        { resource: "table", operation: "create", tableName: "convexa_" + nome, columns: { column: colunas.map((name) => ({ name, type: "string" })) }, options: { createIfNotExists: true } },
        [330 + i * 220, 300],
        { executeOnce: true },
      ),
    );
    ligar(c, antes, n.name);
    antes = n.name;
  });
  const fim = add(code("Pronto", conferir("pr", `return [{ json: { ok: true, tabelas: ${JSON.stringify(Object.keys(TABELAS).map((k) => "convexa_" + k))} } }];`), [330 + Object.keys(TABELAS).length * 220, 300]));
  ligar(c, antes, fim.name);
  return workflow("WF17", N, c);
}

// ------------------------------------------------------------------ gerar
const saida = join(AQUI, "workflows");
rmSync(saida, { recursive: true, force: true });
mkdirSync(saida, { recursive: true });
const todos = [
  wf00(),
  maquina("WF01", "wf01-entendendo.js", { ia: true }),
  maquina("WF02", "wf02-criando-agendamento.js"),
  maquina("WF03", "wf03-disponibilidade.js"),
  maquina("WF04", "wf04-reagendando.js"),
  maquina("WF05", "wf05-cancelando.js"),
  maquina("WF06", "wf06-informacoes-agendamento.js"),
  maquina("WF07", "wf07-servicos.js"),
  maquina("WF08", "wf08-estabelecimento.js", { empresa: true }),
  maquina("WF09", "wf09-atendente.js", { empresa: true }),
  maquina("WF10", "wf10-dados-cliente.js"),
  wf11(),
  maquina("WF12", "wf12-confirmacao.js"),
  wf13(),
  wf14(),
  wf15(),
  wf16(),
  wf17(),
];
for (const w of todos) {
  const nomes = new Set();
  for (const n of w.nodes) {
    if (nomes.has(n.name)) throw new Error(`${w.name}: node repetido "${n.name}"`);
    nomes.add(n.name);
  }
  for (const [de, saidas] of Object.entries(w.connections)) {
    if (!nomes.has(de)) throw new Error(`${w.name}: conexão de node inexistente "${de}"`);
    for (const lista of Object.values(saidas)) for (const s of lista) for (const l of s) if (!nomes.has(l.node)) throw new Error(`${w.name}: conexão para node inexistente "${l.node}"`);
  }
  writeFileSync(join(saida, `${w.name.replace(/[^\p{L}\p{N} ()-]/gu, "").replace(/\s+/g, " ").trim()}.json`), JSON.stringify(w, null, 2));
}
console.log(`${todos.length} workflows em ${saida}`);
