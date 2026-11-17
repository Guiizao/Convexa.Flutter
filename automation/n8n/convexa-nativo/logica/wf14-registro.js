// Monta o registro do erro (Error Trigger) ou do alerta (chamado por outro workflow).
// `chave` evita repetir o mesmo aviso: um por tipo/origem por hora (ou por dia, na cota).
const j = $input.first().json ?? {};
const hora = new Date().toISOString().slice(0, 13);
let linha;
if (j.execution || j.workflow) {
  const ex = j.execution ?? {};
  const node = ex.lastNodeExecuted ?? ex.error?.node?.name ?? "";
  linha = {
    tipo: "ERRO_WORKFLOW",
    mensagem: String(ex.error?.message ?? "erro sem mensagem").slice(0, 500),
    workflow: String(j.workflow?.name ?? ""),
    node: String(node),
    execucao: String(ex.id ?? ""),
    url: String(ex.url ?? ""),
    detalhe: JSON.stringify({ descricao: ex.error?.description ?? null, stack: String(ex.error?.stack ?? "").slice(0, 1500), modo: ex.mode ?? null }),
    chave: `ERRO:${j.workflow?.id ?? ""}:${node}:${hora}`,
  };
} else {
  linha = {
    tipo: String(j.tipo ?? "ALERTA"),
    mensagem: String(j.mensagem ?? "").slice(0, 1000),
    workflow: String(j.origem ?? ""),
    node: "",
    execucao: "",
    url: "",
    detalhe: JSON.stringify(j.detalhe ?? {}).slice(0, 2000),
    chave: String(j.chave ?? `${j.tipo ?? "ALERTA"}:${hora}`),
  };
}
linha.em = new Date().toISOString();
const icone = linha.tipo === "ATENDIMENTO_SOLICITADO" ? "🙋" : linha.tipo.startsWith("ERRO") || linha.tipo.startsWith("FALHA") ? "🔴" : "⚠️";
const texto = `${icone} Convexa — ${linha.tipo}\n${linha.mensagem}${linha.workflow ? `\nWorkflow: ${linha.workflow}${linha.node ? " / " + linha.node : ""}` : ""}${linha.url ? `\n${linha.url}` : ""}`;
return [{ json: { cfg, linha, texto } }];
