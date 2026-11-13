import type { DateTime } from "luxon";
import type { CustomerApi, Gateway, OwnerApi } from "../convexa/gateway.js";
import { nowIn } from "../lib/time.js";
import type { BotSettings } from "../settings/settings.js";
import { vocab } from "../settings/settings.js";
import * as wa from "../whatsapp/messages.js";
import type { Out } from "../whatsapp/messages.js";
import type { ConvState, Conversation } from "./conversations.js";
import { conversations } from "./conversations.js";

export type Biz = {
  businessId: string;
  businessName: string;
  timezone: string;
  phoneNumberId: string;
  settings: BotSettings;
  ownerPhones: string[];
};

export class Ctx {
  readonly out: Out[] = [];
  private customerApi?: Promise<CustomerApi>;
  private ownerApi?: Promise<OwnerApi | undefined>;

  constructor(
    readonly biz: Biz,
    readonly gw: Gateway,
    readonly phone: string, // E.164 de quem escreveu
    public conv: Conversation,
    public state: ConvState,
  ) {}

  get settings() {
    return this.biz.settings;
  }
  get v() {
    return vocab(this.biz.settings);
  }
  get tz() {
    return this.biz.timezone;
  }
  get firstName(): string {
    const n = (this.conv.name ?? "").trim().split(/\s+/)[0] ?? "";
    return n && n.length <= 20 ? n : "";
  }
  /** Nome para avisos ao dono: o do cadastro na ConvexaAPI, senão o do perfil do WhatsApp. */
  async displayName(): Promise<string> {
    try {
      const api = await this.customer();
      if (api.session.customer.name) return api.session.customer.name;
    } catch {
      // sem sessão
    }
    return this.conv.name ?? "Cliente";
  }

  now(): DateTime {
    return nowIn(this.tz);
  }

  customer(): Promise<CustomerApi> {
    this.customerApi ??= this.gw.customer(this.biz.phoneNumberId, this.phone, this.conv.name ?? undefined);
    return this.customerApi;
  }
  owner(): Promise<OwnerApi | undefined> {
    this.ownerApi ??= this.gw.owner(this.biz.businessId);
    return this.ownerApi;
  }

  // ---------- respostas para quem escreveu
  say(body: string) {
    this.out.push(wa.text(this.phone, body));
  }
  buttons(body: string, btns: wa.Button[], opts?: { header?: string; footer?: string }) {
    this.out.push(wa.buttons(this.phone, body, btns, opts));
  }
  list(body: string, button: string, sections: wa.Section[], opts?: { header?: string; footer?: string }) {
    this.out.push(wa.list(this.phone, body, button, sections, opts));
  }
  push(...outs: Out[]) {
    this.out.push(...outs);
  }

  // ---------- estado
  set(flow: string, step: string, data: Record<string, any> = {}) {
    this.state = { ...this.state, flow, step, data: { ...(this.state.flow === flow ? this.state.data : {}), ...data } };
  }
  reset() {
    this.state = this.state.actAsCustomerUntil ? { actAsCustomerUntil: this.state.actAsCustomerUntil } : {};
  }
  get data(): Record<string, any> {
    return this.state.data ?? {};
  }

  /** Mensagem para outro contato (dono ou outro cliente): sessão se a janela de 24h estiver aberta, template se não. */
  async to(phone: string, session: Out, template: Out) {
    const open = await conversations.windowOpen(this.biz.businessId, phone);
    this.out.push(open ? session : template);
  }

  /** Avisa todos os números do dono. */
  async notifyOwner(body: string, btns?: wa.Button[]) {
    for (const phone of this.biz.ownerPhones) {
      if (phone === this.phone) continue;
      const session = btns?.length ? wa.buttons(phone, body, btns) : wa.text(phone, body);
      await this.to(phone, session, ownerTemplate(phone, this.biz.businessName, body));
    }
  }
}

/** Template genérico para falar com o dono fora da janela de 24h. */
export function ownerTemplate(phone: string, businessName: string, body: string): Out {
  return wa.template(phone, "convexa_aviso_dono", [businessName, body], ["o:menu"], `[template aviso ao dono] ${body}`);
}
