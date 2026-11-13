/**
 * Telefones. A ConvexaAPI guarda E.164 (+5514999990000). A Meta manda o wa_id
 * sem "+" e, para celulares brasileiros antigos, às vezes SEM o nono dígito
 * (551499990000). A API recusa esse formato, então devolvemos o nove.
 */

const digits = (s: string) => s.replace(/\D/g, "");

export function waIdToE164(waId: string): string {
  const d = digits(waId);
  // Brasil: 55 + DDD(2) + 8 dígitos começando em 6-9 = celular sem o nono dígito
  if (d.length === 12 && d.startsWith("55") && /[6-9]/.test(d[4] ?? "")) {
    return `+${d.slice(0, 4)}9${d.slice(4)}`;
  }
  return `+${d}`;
}

/** Para enviar pela Meta: só dígitos, sem "+". */
export function e164ToWaId(e164: string): string {
  return digits(e164);
}

/** Forma canônica para comparar: com o nono dígito brasileiro. */
export function canonicalPhone(value: string): string {
  const d = digits(value);
  if (!d) return "";
  // Número nacional sem DDI: assume Brasil
  const withCountry = d.length === 10 || d.length === 11 ? `55${d}` : d;
  return waIdToE164(withCountry);
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return canonicalPhone(a) === canonicalPhone(b);
}

/** (14) 99999-0000 */
export function formatPhoneBR(e164: string): string {
  const d = digits(e164);
  const national = d.startsWith("55") ? d.slice(2) : d;
  if (national.length === 11) return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return e164;
}
