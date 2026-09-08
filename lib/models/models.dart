enum AppointmentStatus { scheduled, confirmed, completed, cancelled, noShow }

extension AppointmentStatusX on AppointmentStatus {
  String get wire => switch (this) {
        AppointmentStatus.scheduled => 'SCHEDULED',
        AppointmentStatus.confirmed => 'CONFIRMED',
        AppointmentStatus.completed => 'COMPLETED',
        AppointmentStatus.cancelled => 'CANCELLED',
        AppointmentStatus.noShow => 'NO_SHOW',
      };

  String get label => switch (this) {
        AppointmentStatus.scheduled => 'Aguardando',
        AppointmentStatus.confirmed => 'Confirmado',
        AppointmentStatus.completed => 'Atendido',
        AppointmentStatus.cancelled => 'Cancelado',
        AppointmentStatus.noShow => 'Não compareceu',
      };

  static AppointmentStatus parse(String? value) => switch (value) {
        'CONFIRMED' => AppointmentStatus.confirmed,
        'COMPLETED' => AppointmentStatus.completed,
        'CANCELLED' => AppointmentStatus.cancelled,
        'NO_SHOW' => AppointmentStatus.noShow,
        _ => AppointmentStatus.scheduled,
      };
}

enum BookingChannel { whatsapp, panel, unknown }

extension BookingChannelX on BookingChannel {
  String get label => switch (this) {
        BookingChannel.whatsapp => 'WhatsApp',
        BookingChannel.panel => 'Painel',
        BookingChannel.unknown => 'Outro',
      };

  static BookingChannel parse(String? value) => switch (value) {
        'WHATSAPP' => BookingChannel.whatsapp,
        'PANEL' => BookingChannel.panel,
        _ => BookingChannel.unknown,
      };
}

class Session {
  final String token;
  final String businessId;
  final String businessName;
  final String userName;
  final String userEmail;

  const Session({
    required this.token,
    required this.businessId,
    required this.businessName,
    required this.userName,
    required this.userEmail,
  });

  factory Session.fromJson(Map<String, dynamic> json) {
    final business = (json['business'] as Map<String, dynamic>?) ?? const {};
    final user = (json['user'] as Map<String, dynamic>?) ??
        (json['owner'] as Map<String, dynamic>?) ??
        const {};
    return Session(
      token: (json['token'] ?? json['accessToken'] ?? '').toString(),
      businessId: (business['id'] ?? json['businessId'] ?? '').toString(),
      businessName: (business['name'] ?? '').toString(),
      userName: (user['name'] ?? '').toString(),
      userEmail: (user['email'] ?? '').toString(),
    );
  }
}

class ServiceItem {
  final String id;
  final String name;
  final int durationMinutes;
  final int priceCents;
  final bool active;

  const ServiceItem({
    required this.id,
    required this.name,
    required this.durationMinutes,
    required this.priceCents,
    this.active = true,
  });

  ServiceItem copyWith({
    String? id,
    String? name,
    int? durationMinutes,
    int? priceCents,
    bool? active,
  }) =>
      ServiceItem(
        id: id ?? this.id,
        name: name ?? this.name,
        durationMinutes: durationMinutes ?? this.durationMinutes,
        priceCents: priceCents ?? this.priceCents,
        active: active ?? this.active,
      );

  factory ServiceItem.fromJson(Map<String, dynamic> json) => ServiceItem(
        id: (json['id'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        durationMinutes: (json['durationMinutes'] as num?)?.toInt() ?? 30,
        priceCents: (json['priceCents'] as num?)?.toInt() ?? 0,
        active: json['active'] as bool? ?? true,
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        'durationMinutes': durationMinutes,
        'priceCents': priceCents,
        'active': active,
      };
}

class Appointment {
  final String id;
  final DateTime startAt;
  final DateTime endAt;
  final String customerName;
  final String? customerPhone;
  final String serviceName;
  final int priceCents;
  final int durationMinutes;
  final AppointmentStatus status;
  final BookingChannel channel;
  final String? notes;
  final bool prepaid;

  const Appointment({
    required this.id,
    required this.startAt,
    required this.endAt,
    required this.customerName,
    required this.serviceName,
    required this.priceCents,
    required this.durationMinutes,
    required this.status,
    this.channel = BookingChannel.unknown,
    this.customerPhone,
    this.notes,
    this.prepaid = false,
  });

  Appointment copyWith({AppointmentStatus? status, bool? prepaid}) =>
      Appointment(
        id: id,
        startAt: startAt,
        endAt: endAt,
        customerName: customerName,
        customerPhone: customerPhone,
        serviceName: serviceName,
        priceCents: priceCents,
        durationMinutes: durationMinutes,
        status: status ?? this.status,
        channel: channel,
        notes: notes,
        prepaid: prepaid ?? this.prepaid,
      );

  factory Appointment.fromJson(Map<String, dynamic> json) {
    final customer = (json['customer'] as Map<String, dynamic>?) ?? const {};
    final service = (json['service'] as Map<String, dynamic>?) ?? const {};
    final start =
        DateTime.tryParse((json['startAt'] ?? '').toString())?.toLocal() ??
            DateTime.now();
    final duration = (json['durationMinutes'] as num?)?.toInt() ?? 30;
    return Appointment(
      id: (json['id'] ?? '').toString(),
      startAt: start,
      endAt: DateTime.tryParse((json['endAt'] ?? '').toString())?.toLocal() ??
          start.add(Duration(minutes: duration)),
      customerName: (customer['name'] ?? json['customerName'] ?? '').toString(),
      customerPhone: (customer['phone'] ?? json['customerPhone'])?.toString(),
      serviceName: (service['name'] ?? json['serviceName'] ?? '').toString(),
      priceCents: (json['priceCents'] as num?)?.toInt() ?? 0,
      durationMinutes: duration,
      status: AppointmentStatusX.parse(json['status']?.toString()),
      channel: BookingChannelX.parse(json['channel']?.toString()),
      notes: json['notes']?.toString(),
      prepaid: json['prepaid'] as bool? ?? false,
    );
  }
}

class TimeRange {
  final int startMinutes;
  final int endMinutes;

  const TimeRange(this.startMinutes, this.endMinutes);

  bool get isValid => endMinutes > startMinutes;
  int get durationMinutes => endMinutes - startMinutes;

  TimeRange copyWith({int? startMinutes, int? endMinutes}) =>
      TimeRange(startMinutes ?? this.startMinutes, endMinutes ?? this.endMinutes);
}

class ShiftBreak {
  final String id;
  final TimeRange range;
  final String label;

  const ShiftBreak({required this.id, required this.range, this.label = 'Intervalo'});
}

enum ShiftState { closed, open, finished }

class WorkShift {
  final DateTime date;
  final ShiftState state;
  final TimeRange hours;
  final int slotMinutes;
  final List<ShiftBreak> breaks;
  final Set<String> activeServiceIds;
  final DateTime? openedAt;
  final DateTime? closedAt;

  const WorkShift({
    required this.date,
    required this.state,
    required this.hours,
    required this.slotMinutes,
    this.breaks = const [],
    this.activeServiceIds = const {},
    this.openedAt,
    this.closedAt,
  });

  bool get isOpen => state == ShiftState.open;

  WorkShift copyWith({
    DateTime? date,
    ShiftState? state,
    TimeRange? hours,
    int? slotMinutes,
    List<ShiftBreak>? breaks,
    Set<String>? activeServiceIds,
    DateTime? openedAt,
    DateTime? closedAt,
  }) =>
      WorkShift(
        date: date ?? this.date,
        state: state ?? this.state,
        hours: hours ?? this.hours,
        slotMinutes: slotMinutes ?? this.slotMinutes,
        breaks: breaks ?? this.breaks,
        activeServiceIds: activeServiceIds ?? this.activeServiceIds,
        openedAt: openedAt ?? this.openedAt,
        closedAt: closedAt ?? this.closedAt,
      );

  static WorkShift initial(DateTime date) => WorkShift(
        date: DateTime(date.year, date.month, date.day),
        state: ShiftState.closed,
        hours: const TimeRange(9 * 60, 19 * 60),
        slotMinutes: 30,
      );
}

class AgentSettings {
  final bool agentEnabled;
  final bool voiceToText;
  final bool ownerChatCommands;
  final bool googleCalendarSync;
  final bool openingBroadcast;
  final bool reminderEnabled;
  final int reminderMinutesBefore;
  final bool prepaymentEnabled;
  final int prepaymentDiscountPercent;
  final bool upsellEnabled;
  final List<String> upsellServiceIds;
  final bool voiceAssistantEnabled;
  final String ownerPhone;
  final String agentPhone;

  const AgentSettings({
    this.agentEnabled = true,
    this.voiceToText = true,
    this.ownerChatCommands = true,
    this.googleCalendarSync = false,
    this.openingBroadcast = true,
    this.reminderEnabled = true,
    this.reminderMinutesBefore = 60,
    this.prepaymentEnabled = false,
    this.prepaymentDiscountPercent = 10,
    this.upsellEnabled = false,
    this.upsellServiceIds = const [],
    this.voiceAssistantEnabled = false,
    this.ownerPhone = '',
    this.agentPhone = '',
  });

  AgentSettings copyWith({
    bool? agentEnabled,
    bool? voiceToText,
    bool? ownerChatCommands,
    bool? googleCalendarSync,
    bool? openingBroadcast,
    bool? reminderEnabled,
    int? reminderMinutesBefore,
    bool? prepaymentEnabled,
    int? prepaymentDiscountPercent,
    bool? upsellEnabled,
    List<String>? upsellServiceIds,
    bool? voiceAssistantEnabled,
    String? ownerPhone,
    String? agentPhone,
  }) =>
      AgentSettings(
        agentEnabled: agentEnabled ?? this.agentEnabled,
        voiceToText: voiceToText ?? this.voiceToText,
        ownerChatCommands: ownerChatCommands ?? this.ownerChatCommands,
        googleCalendarSync: googleCalendarSync ?? this.googleCalendarSync,
        openingBroadcast: openingBroadcast ?? this.openingBroadcast,
        reminderEnabled: reminderEnabled ?? this.reminderEnabled,
        reminderMinutesBefore:
            reminderMinutesBefore ?? this.reminderMinutesBefore,
        prepaymentEnabled: prepaymentEnabled ?? this.prepaymentEnabled,
        prepaymentDiscountPercent:
            prepaymentDiscountPercent ?? this.prepaymentDiscountPercent,
        upsellEnabled: upsellEnabled ?? this.upsellEnabled,
        upsellServiceIds: upsellServiceIds ?? this.upsellServiceIds,
        voiceAssistantEnabled:
            voiceAssistantEnabled ?? this.voiceAssistantEnabled,
        ownerPhone: ownerPhone ?? this.ownerPhone,
        agentPhone: agentPhone ?? this.agentPhone,
      );

  factory AgentSettings.fromJson(Map<String, dynamic> json) => AgentSettings(
        agentEnabled: json['agentEnabled'] as bool? ?? true,
        voiceToText: json['voiceToText'] as bool? ?? true,
        ownerChatCommands: json['ownerChatCommands'] as bool? ?? true,
        googleCalendarSync: json['googleCalendarSync'] as bool? ?? false,
        openingBroadcast: json['openingBroadcast'] as bool? ?? true,
        reminderEnabled: json['reminderEnabled'] as bool? ?? true,
        reminderMinutesBefore:
            (json['reminderMinutesBefore'] as num?)?.toInt() ?? 60,
        prepaymentEnabled: json['prepaymentEnabled'] as bool? ?? false,
        prepaymentDiscountPercent:
            (json['prepaymentDiscountPercent'] as num?)?.toInt() ?? 10,
        upsellEnabled: json['upsellEnabled'] as bool? ?? false,
        upsellServiceIds:
            (json['upsellServiceIds'] as List?)?.map((e) => e.toString()).toList() ??
                const [],
        voiceAssistantEnabled: json['voiceAssistantEnabled'] as bool? ?? false,
        ownerPhone: (json['ownerPhone'] ?? '').toString(),
        agentPhone: (json['agentPhone'] ?? '').toString(),
      );

  Map<String, dynamic> toJson() => {
        'agentEnabled': agentEnabled,
        'voiceToText': voiceToText,
        'ownerChatCommands': ownerChatCommands,
        'googleCalendarSync': googleCalendarSync,
        'openingBroadcast': openingBroadcast,
        'reminderEnabled': reminderEnabled,
        'reminderMinutesBefore': reminderMinutesBefore,
        'prepaymentEnabled': prepaymentEnabled,
        'prepaymentDiscountPercent': prepaymentDiscountPercent,
        'upsellEnabled': upsellEnabled,
        'upsellServiceIds': upsellServiceIds,
        'voiceAssistantEnabled': voiceAssistantEnabled,
        'ownerPhone': ownerPhone,
        'agentPhone': agentPhone,
      };
}

class DashboardMetrics {
  final int customersCount;
  final int customersDelta;
  final int revenueCents;
  final int revenueDeltaPercent;
  final int averageTicketCents;
  final int cancellationsCount;
  final int noShowCount;
  final List<PeriodRevenue> revenueByWeek;
  final List<ServiceShare> serviceShares;

  const DashboardMetrics({
    this.customersCount = 0,
    this.customersDelta = 0,
    this.revenueCents = 0,
    this.revenueDeltaPercent = 0,
    this.averageTicketCents = 0,
    this.cancellationsCount = 0,
    this.noShowCount = 0,
    this.revenueByWeek = const [],
    this.serviceShares = const [],
  });

  bool get isEmpty => customersCount == 0 && revenueCents == 0;

  factory DashboardMetrics.fromJson(Map<String, dynamic> json) =>
      DashboardMetrics(
        customersCount: (json['customersCount'] as num?)?.toInt() ?? 0,
        customersDelta: (json['customersDelta'] as num?)?.toInt() ?? 0,
        revenueCents: (json['revenueCents'] as num?)?.toInt() ?? 0,
        revenueDeltaPercent:
            (json['revenueDeltaPercent'] as num?)?.toInt() ?? 0,
        averageTicketCents:
            (json['averageTicketCents'] as num?)?.toInt() ?? 0,
        cancellationsCount:
            (json['cancellationsCount'] as num?)?.toInt() ?? 0,
        noShowCount: (json['noShowCount'] as num?)?.toInt() ?? 0,
        revenueByWeek: (json['revenueByWeek'] as List?)
                ?.map((e) => PeriodRevenue.fromJson(e as Map<String, dynamic>))
                .toList() ??
            const [],
        serviceShares: (json['serviceShares'] as List?)
                ?.map((e) => ServiceShare.fromJson(e as Map<String, dynamic>))
                .toList() ??
            const [],
      );
}

class PeriodRevenue {
  final String label;
  final int previousCents;
  final int currentCents;

  const PeriodRevenue(this.label, this.previousCents, this.currentCents);

  factory PeriodRevenue.fromJson(Map<String, dynamic> json) => PeriodRevenue(
        (json['label'] ?? '').toString(),
        (json['previousCents'] as num?)?.toInt() ?? 0,
        (json['currentCents'] as num?)?.toInt() ?? 0,
      );
}

class ServiceShare {
  final String name;
  final int count;
  final double percent;

  const ServiceShare(this.name, this.count, this.percent);

  factory ServiceShare.fromJson(Map<String, dynamic> json) => ServiceShare(
        (json['name'] ?? '').toString(),
        (json['count'] as num?)?.toInt() ?? 0,
        (json['percent'] as num?)?.toDouble() ?? 0,
      );
}

class AppNotification {
  final String id;
  final String title;
  final String body;
  final DateTime createdAt;
  final Appointment? appointment;
  final bool read;

  const AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.createdAt,
    this.appointment,
    this.read = false,
  });
}
