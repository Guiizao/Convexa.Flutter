const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 4500 -> "R$ 45,00" (com espaço normal, não o NBSP do Intl) */
export function brl(cents: number): string {
  return fmt.format(cents / 100).replace(/ /g, " ");
}

export function percentOf(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}
