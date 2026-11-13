import { norm } from "../lib/text.js";

export type CustomerIntent =
  | "greeting"
  | "menu"
  | "book"
  | "my_appointments"
  | "reschedule"
  | "cancel"
  | "confirm_presence"
  | "prices"
  | "info"
  | "payment"
  | "human"
  | "thanks"
  | "yes"
  | "no"
  | "unknown";

export type OwnerIntent =
  | "menu"
  | "agenda"
  | "next"
  | "free"
  | "revenue"
  | "block"
  | "leave_early"
  | "arrive_late"
  | "day_off"
  | "notice"
  | "delay"
  | "cancel_appointment"
  | "pending_payments"
  | "pause_bot"
  | "resume_bot"
  | "act_as_customer"
  | "act_as_owner"
  | "unknown";

const has = (t: string, re: RegExp) => re.test(t);

export function yesNo(input: string): "yes" | "no" | undefined {
  const t = norm(input);
  // Só mensagens curtas: "sim", "sim, pode", "não obrigado". Frases com ação ("quero remarcar") não são sim/não.
  if (t.split(" ").length > 4) return undefined;
  if (/^(sim|s|ss|claro|pode|pode ser|ok|okay|beleza|blz|isso|isso mesmo|confirmo|confirmar|quero|bora|fechado|perfeito|certo|com certeza|positivo)$/.test(t))
    return "yes";
  if (/^(sim|claro|ok|pode|isso)\b(?! .*\b(remarc|cancel|desmarc|mud|troc)).*$/.test(t)) return "yes";
  if (/^(nao|n|nn|negativo|nao quero|deixa|deixa pra la|esquece|agora nao)$/.test(t)) return "no";
  if (/^nao\b(?! .*\b(remarc|cancel|desmarc|vou|consigo|posso)).*$/.test(t)) return "no";
  return undefined;
}

/** "1", "opção 2", "a 3" -> número escolhido de um menu em texto */
export function menuNumber(input: string): number | undefined {
  const m = norm(input).match(/^(?:opcao |numero |a |o )?(\d{1,2})$/);
  return m ? Number(m[1]) : undefined;
}

export function customerIntent(input: string): CustomerIntent {
  const t = norm(input);
  if (!t) return "unknown";

  if (has(t, /\b(atendente|humano|pessoa|alguem|falar com (o |a |um |uma )?(dono|dona|responsavel|gerente|barbeiro|profissional|atendente))\b/)) return "human";
  if (has(t, /\b(cancelar|cancela|desmarcar|desmarca|nao vou (poder|conseguir) (ir|comparecer)|nao vou mais)\b/)) return "cancel";
  if (has(t, /\b(remarcar|remarca|reagendar|mudar (o |meu )?(horario|dia)|trocar (o |meu )?(horario|dia)|adiar|antecipar|outro (horario|dia))\b/))
    return "reschedule";
  if (has(t, /\b(meus? (horarios?|agendamentos?)|(qual|quando) (e |eh )?(o )?meu|tenho (algum )?(horario|agendamento)( marcado)?\b(?! (amanha|hoje|livre|disponivel))|ja (estou|to) marcad|marquei)\b/))
    return "my_appointments";
  if (has(t, /\b(confirmo presenca|vou sim|estarei la|to indo|estou indo|vou comparecer|confirmar presenca|confirmo o horario)\b/)) return "confirm_presence";
  if (has(t, /\b(comprovante|paguei|pix|sinal|pagamento|pagar)\b/)) return "payment";
  if (has(t, /\b(agendar|marcar|marca|reservar|vaga|disponivel|encaixe|encaixar|tem como|consigo|quero (fazer|cortar|um |uma )|queria (fazer|cortar|marcar|um |uma ))\b|\btem horario\b|\bhorario (pra|para|amanha|hoje)\b/))
    return "book";
  if (has(t, /\b(preco|precos|valor|valores|quanto (custa|e|fica|ta|sai)|tabela|servicos|o que voces fazem|cardapio)\b/)) return "prices";
  if (has(t, /\b(endereco|onde fica|localizacao|como chego|abrem?|fecham?|funcionamento|aberto|atendem? (hoje|amanha|domingo|sabado|feriado)|forma de pagamento|aceita)\b/))
    return "info";
  const yn = yesNo(t);
  if (yn) return yn;
  if (has(t, /\b(obrigad[oa]|valeu|vlw|obg|brigad[oa]|agradeco|tmj)\b/)) return "thanks";
  if (has(t, /^(menu|inicio|comecar|voltar|opcoes|ajuda)$/)) return "menu";
  if (has(t, /\b(oi|ola|bom dia|boa tarde|boa noite|e ai|eae|opa|salve|hello|hey|tudo bem)\b/)) return "greeting";
  if (has(t, /\bhorario\b/)) return "book";
  return "unknown";
}

export function ownerIntent(input: string): OwnerIntent {
  const t = norm(input);
  if (!t) return "unknown";
  if (has(t, /^(menu|ajuda|comandos|opcoes|inicio|o que voce faz)$/)) return "menu";
  if (has(t, /\bmodo (cliente|teste)\b|\btestar como cliente\b/)) return "act_as_customer";
  if (has(t, /\bmodo dono\b|\bsair do modo cliente\b/)) return "act_as_owner";
  if (has(t, /\b(pausar?|pausa|desliga|desligar|parar?) (o )?(bot|robo|atendimento|automatico)\b/)) return "pause_bot";
  if (has(t, /\b(ativar?|ativa|liga|ligar|voltar?|retomar?) (o )?(bot|robo|atendimento|automatico)\b/)) return "resume_bot";
  if (has(t, /\b(comprovantes?|pagamentos? pendentes?|sinais? pendentes?|quem pagou|pix pendente)\b/)) return "pending_payments";
  if (has(t, /\b(vou (me )?atrasar|estou atrasad|to atrasad|vou chegar atrasad|atraso de)\b/)) return "delay";
  if (has(t, /\b(avisa|avise|avisar|manda (uma )?mensagem|mande (uma )?mensagem|comunica|comunicar|informa|informar|fala pros?|diz pros?)\b/))
    return "notice";
  if (has(t, /\b(sair (mais )?cedo|vou embora|fechar (mais )?cedo|encerrar (mais )?cedo|vou sair)\b/)) return "leave_early";
  if (has(t, /\b(chegar (mais )?tarde|vou chegar|so chego|comecar (mais )?tarde|abrir (mais )?tarde)\b/)) return "arrive_late";
  if (has(t, /\b(nao vou (trabalhar|abrir|atender)|vou fechar|folga|fechar (a agenda|o dia)|dia de folga|nao abro)\b/)) return "day_off";
  if (has(t, /\b(bloquear?|bloqueia|bloqueie|reservar? (pra|para) mim|vou estar ocupad|ocupad[oa]|compromisso|nao vou estar|tenho (um )?compromisso|reajust|liberar? a agenda)\b/))
    return "block";
  if (has(t, /\bcancel(a|ar|e)\b.*\b(horario|agendamento|cliente|do|da)\b/)) return "cancel_appointment";
  if (has(t, /\b(faturamento|faturei|faturou|fatura|lucro|lucrei|ganhei|receita|vendas|vendi|quanto (eu )?(fiz|ganhei|entrou)|caixa|resultado)\b/))
    return "revenue";
  if (has(t, /\b(proximo cliente|quem e o proximo|proximo atendimento|quem vem agora|proximo horario)\b/)) return "next";
  if (has(t, /\b(horarios? (livres?|vagos?|disponive(l|is))|vagas?|buracos?|tenho (horario|espaco|vaga)|encaixe|janela)\b/)) return "free";
  if (has(t, /\b(agenda|clientes? (de|para|pra) |atendimentos|o que (eu )?tenho|quem vem|quantos clientes|marcados|marcacoes|agendamentos)\b/))
    return "agenda";
  return "unknown";
}

/** Extrai o texto do aviso: "avisa meus clientes de hoje que vou atrasar" -> "vou atrasar" */
export function noticeText(input: string): string | undefined {
  const m = input.match(/\b(?:que|q)\b\s+(.+)$/i);
  const text = m?.[1]?.trim();
  return text && text.length >= 3 ? text.charAt(0).toUpperCase() + text.slice(1) : undefined;
}

/** "atrasar 20 minutos" -> 20 */
export function delayMinutes(input: string): number | undefined {
  const t = norm(input);
  const m = t.match(/(\d{1,3})\s*(min|minutos?|m)\b/);
  if (m) return Number(m[1]);
  if (/\bmeia hora\b/.test(t)) return 30;
  if (/\buma hora\b/.test(t)) return 60;
  return undefined;
}
