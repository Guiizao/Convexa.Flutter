import '../models/models.dart';

/// Conjunto de dados usado APENAS no modo demonstração, que é opt-in pela
/// tela de login. Em operação normal o painel lê tudo da API — nada aqui
/// vaza para o modo conectado.
class SampleData {
  static const _serviceCatalog = [
    ('svc-corte', 'Corte masculino', 30, 4000),
    ('svc-barba', 'Barba', 20, 2500),
    ('svc-combo', 'Corte + barba', 50, 6000),
    ('svc-pezinho', 'Acabamento', 15, 1500),
    ('svc-platinado', 'Descoloração', 90, 12000),
  ];

  static List<ServiceItem> services() => _serviceCatalog
      .map((s) => ServiceItem(
            id: s.$1,
            name: s.$2,
            durationMinutes: s.$3,
            priceCents: s.$4,
            active: s.$1 != 'svc-platinado',
          ))
      .toList();

  static List<Appointment> appointmentsFor(DateTime date) {
    final day = DateTime(date.year, date.month, date.day);
    final entries = <(int, int, String, String, String, int, AppointmentStatus, BookingChannel, bool)>[
      (9, 0, 'Daniel Morais', '5511970000001', 'Corte + barba', 6000,
          AppointmentStatus.completed, BookingChannel.whatsapp, true),
      (9, 50, 'Rafael Lins', '5511970000002', 'Corte masculino', 4000,
          AppointmentStatus.completed, BookingChannel.whatsapp, false),
      (11, 0, 'Bruno Tavares', '5511970000003', 'Barba', 2500,
          AppointmentStatus.confirmed, BookingChannel.panel, false),
      (14, 30, 'Igor Nakamura', '5511970000004', 'Corte + barba', 6000,
          AppointmentStatus.confirmed, BookingChannel.whatsapp, true),
      (15, 30, 'Caio Ferreira', '5511970000005', 'Corte masculino', 4000,
          AppointmentStatus.scheduled, BookingChannel.whatsapp, false),
      (17, 0, 'Marcos Aurélio', '5511970000006', 'Acabamento', 1500,
          AppointmentStatus.scheduled, BookingChannel.whatsapp, false),
    ];

    return entries.map((e) {
      final start = day.add(Duration(hours: e.$1, minutes: e.$2));
      final duration = e.$6 >= 6000 ? 50 : (e.$6 <= 1500 ? 15 : 30);
      return Appointment(
        id: 'demo-${e.$1}-${e.$2}',
        startAt: start,
        endAt: start.add(Duration(minutes: duration)),
        customerName: e.$3,
        customerPhone: e.$4,
        serviceName: e.$5,
        priceCents: e.$6,
        durationMinutes: duration,
        status: e.$7,
        channel: e.$8,
        prepaid: e.$9,
      );
    }).toList();
  }

  static Set<int> bookedDays(DateTime month) {
    final lastDay = DateTime(month.year, month.month + 1, 0).day;
    return {
      for (var d = 1; d <= lastDay; d++)
        if (d % 3 != 0 && DateTime(month.year, month.month, d).weekday != 7) d
    };
  }

  static WorkShift shiftFor(DateTime date) => WorkShift(
        date: DateTime(date.year, date.month, date.day),
        state: ShiftState.open,
        hours: const TimeRange(9 * 60, 19 * 60),
        slotMinutes: 30,
        breaks: const [
          ShiftBreak(id: 'b1', range: TimeRange(12 * 60, 13 * 60), label: 'Almoço'),
        ],
        activeServiceIds: services().where((s) => s.active).map((s) => s.id).toSet(),
        openedAt: DateTime(date.year, date.month, date.day, 8, 52),
      );

  static DashboardMetrics metrics() => const DashboardMetrics(
        customersCount: 148,
        customersDelta: 23,
        revenueCents: 812500,
        revenueDeltaPercent: 18,
        averageTicketCents: 5490,
        cancellationsCount: 6,
        noShowCount: 4,
        revenueByWeek: [
          PeriodRevenue('Semana 1', 158000, 184000),
          PeriodRevenue('Semana 2', 172000, 205000),
          PeriodRevenue('Semana 3', 165000, 198000),
          PeriodRevenue('Semana 4', 191000, 225500),
        ],
        serviceShares: [
          ServiceShare('Corte + barba', 61, 41.2),
          ServiceShare('Corte masculino', 48, 32.4),
          ServiceShare('Barba', 24, 16.2),
          ServiceShare('Acabamento', 15, 10.2),
        ],
      );

  static List<AppNotification> notifications(DateTime date) {
    final appts = appointmentsFor(date);
    final pending = appts.where((a) => a.status == AppointmentStatus.scheduled);
    return pending
        .map((a) => AppNotification(
              id: 'notif-${a.id}',
              title: 'Novo agendamento',
              body: '${a.customerName} reservou ${a.serviceName}',
              createdAt: a.startAt.subtract(const Duration(hours: 3)),
              appointment: a,
            ))
        .toList();
  }
}
