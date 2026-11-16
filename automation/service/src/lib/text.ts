/** minúsculas, sem acento, sem pontuação, espaços simples */
export function norm(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9:/\s+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Corta respeitando o limite da Meta, com reticências. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

// Palavras de conversa que não podem casar "pelo radical" com o nome de um serviço:
// "quero" ~ "queratina", "barbeiro" ~ "barba", "marcar" ~ "marcação".
const NOT_A_NAME = new Set(
  (
    "quero queria queremos querer quer gostaria preciso posso pode poderia como para hoje amanha depois agendar agenda marcar marca marcacao " +
    "horario horarios fazer favor obrigado obrigada tarde noite manha cliente clientes barbeiro barbeiros barbearia salao clinica estudio " +
    "profissional profissionais atendimento atendente servico servicos procedimento sessao consigo encaixe encaixar semana proxima proximo"
  ).split(" "),
);

/**
 * Acha o item cujo nome aparece no texto. Prefere o nome mais longo
 * ("corte + barba" ganha de "corte") e tolera um erro de digitação por palavra.
 * Nome parcial vale ("hidratação" acha "Hidratação capilar profunda"), desde que
 * pelo menos uma palavra bata de verdade, e não só pelo radical.
 */
export function findByName<T>(text: string, items: T[], name: (t: T) => string): T | undefined {
  const t = ` ${norm(text)} `;
  const tokens = t.trim().split(" ");
  const scored = items
    .map((item) => {
      const n = norm(name(item));
      if (!n) return { item, score: 0 };
      const words = n.split(" ").filter((w) => w.length >= 3 && w !== "com");
      const exact = t.includes(` ${n} `) || t.includes(` ${n}s `);
      const strongHit = (w: string) => tokens.some((tok) => tok === w || tok === `${w}s` || (w.length >= 5 && levenshtein(tok, w) <= 1));
      // mesmo radical: "cortar" ~ "corte", "barbear" ~ "barba"
      const stemHit = (w: string) => tokens.some((tok) => w.length >= 5 && tok.length >= 5 && !NOT_A_NAME.has(tok) && tok.slice(0, 4) === w.slice(0, 4));
      const strong = words.filter(strongHit).length;
      const hits = words.filter((w) => strongHit(w) || stemHit(w)).length;
      // casou todas as palavras: quanto mais palavras, mais específico ("corte + barba" > "corte")
      const full = exact || (words.length > 0 && hits === words.length);
      const score = full ? Math.max(words.length, 1) * 100 + (exact ? 10 : 0) : strong > 0 ? hits * 10 : 0;
      return { item, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.item;
}
