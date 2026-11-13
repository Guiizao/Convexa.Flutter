// Cria um estabelecimento de demonstração completo na ConvexaAPI.
// Uso: node automation/scripts/seed-demo.mjs http://localhost:3000
// Idempotente: se o e-mail já existir, só faz login e completa o que faltar.

const BASE = process.argv[2] ?? "http://localhost:3000";

export const DEMO = {
  business: {
    name: "Barbearia Navalha",
    slug: "navalha-demo",
    timezone: "America/Sao_Paulo",
  },
  owner: {
    name: "Rafael Navalha",
    email: "dono@navalha.demo",
    password: "Navalha#2026demo",
  },
  ownerPhone: "+5514999990000",
  meta: {
    metaPhoneNumberId: "100000000000001",
    metaWabaId: "200000000000001",
    metaAccessToken: "SIMULADOR-ACCESS-TOKEN",
    metaAppSecret: "simulador-app-secret",
  },
  services: [
    { name: "Corte", durationMinutes: 40, priceCents: 4500 },
    { name: "Barba", durationMinutes: 30, priceCents: 3500 },
    { name: "Corte + Barba", durationMinutes: 70, priceCents: 7000 },
    { name: "Sobrancelha", durationMinutes: 15, priceCents: 1500 },
    { name: "Pigmentação", durationMinutes: 60, priceCents: 6000 },
  ],
  employees: [
    { name: "Pedro", services: "*" },
    { name: "Lucas", services: ["Corte", "Barba", "Corte + Barba"] },
  ],
};

// Seg a sáb, 09:00 às 19:00 (minutos do dia)
const WEEK = [1, 2, 3, 4, 5, 6];
const OPEN = 9 * 60;
const CLOSE = 19 * 60;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(new URL(path, BASE), {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => undefined);
  return { status: res.status, data };
}

async function main() {
  let session = await call("POST", "/api/auth/register", {
    body: { business: DEMO.business, owner: DEMO.owner },
  });

  if (session.status === 409) {
    session = await call("POST", "/api/auth/login", {
      body: { email: DEMO.owner.email, password: DEMO.owner.password },
    });
  }
  if (session.status >= 300) {
    throw new Error(`login/registro falhou: ${session.status} ${JSON.stringify(session.data)}`);
  }
  const token = session.data.accessToken;
  console.log(`✓ empresa ${session.data.business.name}`);

  const patched = await call("PATCH", "/api/business", {
    token,
    body: { phone: DEMO.ownerPhone, ...DEMO.meta },
  });
  if (patched.status >= 300) throw new Error(`PATCH business: ${JSON.stringify(patched.data)}`);
  console.log(`✓ número da Meta ${DEMO.meta.metaPhoneNumberId}, dono ${DEMO.ownerPhone}`);

  const hours = WEEK.map((dayOfWeek) => ({ dayOfWeek, opensAt: OPEN, closesAt: CLOSE }));
  const setHours = await call("PUT", "/api/business/hours", { token, body: { hours } });
  if (setHours.status >= 300) throw new Error(`hours: ${JSON.stringify(setHours.data)}`);
  console.log("✓ jornada seg a sáb, 09:00 às 19:00");

  const existing = await call("GET", "/api/services?perPage=100&includeInactive=true", { token });
  const byName = new Map((existing.data?.data ?? []).map((s) => [s.name, s]));
  for (const service of DEMO.services) {
    if (!byName.has(service.name)) {
      const created = await call("POST", "/api/services", { token, body: service });
      if (created.status >= 300) throw new Error(`service: ${JSON.stringify(created.data)}`);
      byName.set(service.name, created.data);
    }
  }
  console.log(`✓ ${DEMO.services.length} serviços`);

  const emps = await call("GET", "/api/employees?perPage=100&includeInactive=true", { token });
  const empNames = new Set((emps.data?.data ?? []).map((e) => e.name));
  for (const employee of DEMO.employees) {
    if (empNames.has(employee.name)) continue;
    const serviceIds = (employee.services === "*" ? DEMO.services.map((s) => s.name) : employee.services)
      .map((n) => byName.get(n).id);
    const created = await call("POST", "/api/employees", {
      token,
      body: {
        name: employee.name,
        serviceIds,
        hours: WEEK.map((dayOfWeek) => ({ dayOfWeek, startsAt: OPEN, endsAt: CLOSE })),
      },
    });
    if (created.status >= 300) throw new Error(`employee: ${JSON.stringify(created.data)}`);
  }
  console.log(`✓ ${DEMO.employees.length} profissionais`);
  console.log(`\nPainel: ${DEMO.owner.email} / ${DEMO.owner.password}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
