import type {
  Availability,
  BusinessInfo,
  ConvAppointment,
  Employee,
  OwnerAppointment,
  Service,
  Session,
  TimeBlock,
} from "./types.js";

/**
 * Tudo que o bot precisa da ConvexaAPI. A implementação real está em
 * client.ts; os testes usam uma agenda em memória com o mesmo contrato.
 */
export interface CustomerApi {
  session: Session;
  services(): Promise<Service[]>;
  availability(q: { serviceId: string; date: string; employeeId?: string; limit?: number }): Promise<Availability>;
  appointments(): Promise<ConvAppointment[]>;
  book(input: { serviceId: string; employeeId: string; startAt: string; notes?: string }): Promise<ConvAppointment>;
  cancel(id: string): Promise<ConvAppointment>;
  reschedule(id: string, input: { startAt: string; employeeId?: string }): Promise<ConvAppointment>;
}

export interface OwnerApi {
  business(): Promise<BusinessInfo>;
  services(): Promise<Service[]>;
  employees(): Promise<Employee[]>;
  appointments(q: { from?: string; to?: string; status?: OwnerAppointment["status"]; customerId?: string }): Promise<OwnerAppointment[]>;
  appointment(id: string): Promise<OwnerAppointment>;
  confirm(id: string): Promise<OwnerAppointment>;
  cancel(id: string): Promise<OwnerAppointment>;
  availability(q: { serviceId: string; date: string; employeeId?: string; limit?: number; slotIntervalMinutes?: number }): Promise<Availability>;
  createTimeBlock(input: { startAt: string; endAt: string; employeeId?: string; reason?: string }): Promise<TimeBlock>;
  updateTimeBlock(id: string, input: { startAt?: string; endAt?: string; reason?: string }): Promise<TimeBlock>;
  deleteTimeBlock(id: string): Promise<void>;
  timeBlocks(q: { from?: string; to?: string }): Promise<TimeBlock[]>;
  addClosedDay(input: { date: string; reason?: string }): Promise<unknown>;
}

export interface Gateway {
  tenant(phoneNumberId: string): Promise<{ businessId: string; name: string; timezone: string }>;
  /** Abre (ou reabre) a sessão de conversa de um telefone. */
  customer(phoneNumberId: string, phone: string, name?: string): Promise<CustomerApi>;
  /** Sessão do dono. undefined se a automação não foi conectada no painel. */
  owner(businessId: string): Promise<OwnerApi | undefined>;
}
