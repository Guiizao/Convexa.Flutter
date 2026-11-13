/**
 * Pix "copia e cola" (BR Code, padrão EMV MPM do Banco Central).
 * Manual de Padrões para Iniciação do Pix, anexo I.
 */

function field(id: string, value: string): string {
  const len = Buffer.byteLength(value, "utf8");
  if (len > 99) throw new Error(`Campo ${id} do Pix passou de 99 bytes`);
  return `${id}${String(len).padStart(2, "0")}${value}`;
}

/** CRC16-CCITT-FALSE (polinômio 0x1021, inicial 0xFFFF), como o BCB exige. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(payload, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Remove acento e caractere fora do conjunto aceito pelos bancos. */
function clean(value: string, max: number): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,\-@/]/g, "")
    .trim()
    .slice(0, max);
}

export type PixInput = {
  key: string;
  merchantName: string;
  merchantCity: string;
  amountCents?: number;
  txid?: string; // até 25 alfanuméricos
  description?: string;
};

export function normalizePixKey(key: string): string {
  const k = key.trim();
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(k)) return k.toLowerCase(); // e-mail
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase(); // aleatória
  const digits = k.replace(/\D/g, "");
  if (k.startsWith("+")) return `+${digits}`; // telefone
  if (digits.length === 11 && /^(\d{2})9/.test(digits) && !/^\d{3}\.\d{3}/.test(k)) {
    // 11 dígitos começando com DDD+9: pode ser celular ou CPF. Com máscara de CPF fica CPF.
    return digits;
  }
  return digits; // CPF / CNPJ
}

export function brCode(input: PixInput): string {
  const gui = field("00", "br.gov.bcb.pix");
  const key = field("01", normalizePixKey(input.key));
  // Descrição só com letras, números e espaço: vários bancos recusam pontuação aqui
  const descText = input.description ? clean(input.description, 40).replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() : "";
  const desc = descText ? field("02", descText) : "";
  const merchantAccount = field("26", gui + key + desc);
  const txid = clean(input.txid ?? "***", 25).replace(/[^A-Za-z0-9*]/g, "") || "***";
  const parts = [
    field("00", "01"),
    field("01", "12"), // uso único
    merchantAccount,
    field("52", "0000"),
    field("53", "986"),
    input.amountCents !== undefined ? field("54", (input.amountCents / 100).toFixed(2)) : "",
    field("58", "BR"),
    field("59", clean(input.merchantName, 25) || "Recebedor"),
    field("60", clean(input.merchantCity, 15) || "Brasil"),
    field("62", field("05", txid)),
  ];
  const withoutCrc = parts.join("") + "6304";
  return withoutCrc + crc16(withoutCrc);
}

/** Lê os campos principais de um BR Code (usado nos testes e na conferência). */
export function parseBrCode(code: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < code.length) {
    const id = code.slice(i, i + 2);
    const len = Number(code.slice(i + 2, i + 4));
    out[id] = code.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

export function randomTxid(prefix = "CVX"): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = prefix;
  while (s.length < 20) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
