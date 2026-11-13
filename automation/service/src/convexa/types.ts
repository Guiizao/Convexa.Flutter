// Formatos devolvidos pela ConvexaAPI (só o que a automação usa)

export type Service = { id: string; name: string; durationMinutes: number; priceCents: number; active?: boolean };

export type Slot = {
  employeeId: string;
  employeeName: string | null;
  startAt: string;
  endAt: string;
  time: string; // HH:mm no fuso da empresa
};

export type Availability = {
  date: string;
  weekday?: string;
  serviceId: string;
  durationMinutes: number;
  totalSlots: number;
  slots: Slot[];
};

export type ConvAppointment = {
  id: string;
  status: "SCHEDULED" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
  startAt: string;
  endAt: string;
  date: string;
  weekday: string;
  time: string;
  priceCents: number;
  durationMinutes: number;
  service: { id: string; name: string };
  employee: { id: string; name: string };
};

export type Session = {
  token: string;
  business: { id: string; name: string; timezone: string };
  customer: { id: string; name: string; phone: string };
  now: { date: string; weekday: string; time: string };
};

/** Agendamento como o painel vê (rotas /api) */
export type OwnerAppointment = {
  id: string;
  status: ConvAppointment["status"];
  startAt: string;
  endAt: string;
  priceCents: number;
  durationMinutes: number;
  notes?: string | null;
  customer: { id: string; name: string; phone: string };
  service: { id: string; name: string };
  employee: { id: string; name: string };
};

export type Employee = {
  id: string;
  name: string;
  active: boolean;
  services?: Array<{ id: string; name: string } | { serviceId: string }>;
};

export type BusinessInfo = {
  id: string;
  name: string;
  timezone: string;
  phone: string | null;
  metaPhoneNumberId: string | null;
  slotIntervalMinutes: number;
  hours?: Array<{ dayOfWeek: number; opensAt: number; closesAt: number }>;
};

export type TimeBlock = { id: string; startAt: string; endAt: string; employeeId: string | null; reason: string | null };

export class ConvexaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
  get isConflict() {
    return this.status === 409;
  }
}
