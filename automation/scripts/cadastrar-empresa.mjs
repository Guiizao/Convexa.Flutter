// Cadastra um estabelecimento novo e a conta do dono na ConvexaAPI.
// Uso:
//   API_URL=https://api.seudominio.com.br SENHA='senha-forte-do-dono' node cadastrar-empresa.mjs \
//     --nome "Barbearia Navalha" --slug barbearia-navalha --telefone "(14) 99999-0000" \
//     --dono "Rafael Souza" --email dono@navalha.com.br [--intervalo 15]
// Depois o dono entra no painel e configura Serviços, Equipe, WhatsApp e Automação.
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    nome: { type: "string" },
    slug: { type: "string" },
    telefone: { type: "string" },
    dono: { type: "string" },
    email: { type: "string" },
    intervalo: { type: "string", default: "15" },
    fuso: { type: "string", default: "America/Sao_Paulo" },
  },
});
const API = process.env.API_URL;
const senha = process.env.SENHA;
const faltando = ["nome", "slug", "dono", "email"].filter((k) => !values[k]);
if (!API || !senha || faltando.length) {
  console.error(`Faltou: ${[...(API ? [] : ["API_URL"]), ...(senha ? [] : ["SENHA"]), ...faltando.map((k) => `--${k}`)].join(", ")}`);
  console.error("Veja o exemplo no topo deste arquivo.");
  process.exit(1);
}

const res = await fetch(new URL("/api/auth/register", API), {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({
    business: {
      name: values.nome,
      slug: values.slug,
      timezone: values.fuso,
      slotIntervalMinutes: Number(values.intervalo),
      ...(values.telefone ? { phone: values.telefone } : {}),
    },
    owner: { name: values.dono, email: values.email, password: senha },
  }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`A API recusou (${res.status}): ${body.message ?? JSON.stringify(body)}`);
  if (body.details) console.error(JSON.stringify(body.details, null, 2));
  process.exit(1);
}
console.log(`Pronto: "${values.nome}" cadastrado. O dono entra no painel com ${values.email}.`);
console.log("Próximos passos no painel: Serviços → Equipe → Configurações (WhatsApp) → Automação (conectar e regras).");
