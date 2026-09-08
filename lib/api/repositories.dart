import '../models/models.dart';
import 'api_client.dart';
import 'sample_data.dart';

/// Quando `demoMode` é true o painel opera com um conjunto local de dados
/// para demonstração, sem tocar na API. Ele é ligado automaticamente ao
/// entrar pelo botão "Explorar em modo demonstração" na tela de login.
class RepositoryContext {
  final ApiClient api;
  bool demoMode;

  RepositoryContext({required this.api, this.demoMode = false});
}

class AuthRepository {
  final RepositoryContext ctx;
  AuthRepository(this.ctx);

  /// API: POST /api/auth/login
  /// body { email, password } -> { token, user, business }
  Future<Session> signIn(String email, String password) async {
    final data = await ctx.api.post('/api/auth/login', body: {
      'email': email.trim(),
      'password': password,
    });
    final session = Session.fromJson(_asMap(data));
    if (session.token.isEmpty) {
      throw const ApiException(500, 'A API não devolveu um token de acesso.');
    }
    ctx.api.setToken(session.token);
    return session;
  }

  /// API: POST /api/auth/register
  /// body { business: { name, slug }, owner: { name, email, password } }
  Future<Session> register({
    required String businessName,
    required String businessSlug,
    required String ownerName,
    required String email,
    required String password,
  }) async {
    final data = await ctx.api.post('/api/auth/register', body: {
      'business': {'name': businessName, 'slug': businessSlug},
      'owner': {'name': ownerName, 'email': email.trim(), 'password': password},
    });
    final session = Session.fromJson(_asMap(data));
    if (session.token.isNotEmpty) ctx.api.setToken(session.token);
    return session;
  }

  /// API: GET /api/auth/me — revalida o token guardado ao reabrir o painel.
  Future<Session> me() async {
    final data = await ctx.api.get('/api/auth/me');
    return Session.fromJson(_asMap(data));
  }

  void signOut() => ctx.api.clearToken();
}

class ServiceRepository {
  final RepositoryContext ctx;
  ServiceRepository(this.ctx);

  /// API: GET /api/services
  Future<List<ServiceItem>> list() async {
    if (ctx.demoMode) return SampleData.services();
    final data = await ctx.api.get('/api/services');
    return _asList(data).map(ServiceItem.fromJson).toList();
  }

  /// API: POST /api/services
  Future<ServiceItem> create(ServiceItem service) async {
    if (ctx.demoMode) {
      return service.copyWith(
          id: 'demo-${DateTime.now().microsecondsSinceEpoch}');
    }
    final data = await ctx.api.post('/api/services', body: service.toJson());
    return ServiceItem.fromJson(_asMap(data));
  }

  /// API: PATCH /api/services/:id
  Future<ServiceItem> update(ServiceItem service) async {
    if (ctx.demoMode) return service;
    final data = await ctx.api
        .patch('/api/services/${service.id}', body: service.toJson());
    return ServiceItem.fromJson(_asMap(data));
  }

  /// API: DELETE /api/services/:id
  Future<void> remove(String id) async {
    if (ctx.demoMode) return;
    await ctx.api.delete('/api/services/$id');
  }
}

class ScheduleRepository {
  final RepositoryContext ctx;
  ScheduleRepository(this.ctx);

  /// API: GET /api/appointments?date=YYYY-MM-DD
  Future<List<Appointment>> byDate(DateTime date) async {
    if (ctx.demoMode) return SampleData.appointmentsFor(date);
    final data = await ctx.api.get('/api/appointments', query: {
      'date': _isoDate(date),
    });
    return _asList(data).map(Appointment.fromJson).toList();
  }

  /// API: GET /api/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD
  /// Usado para marcar no calendário quais dias do mês têm agendamento.
  Future<Set<int>> bookedDaysOfMonth(DateTime month) async {
    if (ctx.demoMode) return SampleData.bookedDays(month);
    final first = DateTime(month.year, month.month, 1);
    final last = DateTime(month.year, month.month + 1, 0);
    final data = await ctx.api.get('/api/appointments', query: {
      'from': _isoDate(first),
      'to': _isoDate(last),
    });
    return _asList(data)
        .map(Appointment.fromJson)
        .map((a) => a.startAt.day)
        .toSet();
  }

  /// API: PATCH /api/appointments/:id  body { status }
  Future<void> setStatus(String id, AppointmentStatus status) async {
    if (ctx.demoMode) return;
    await ctx.api
        .patch('/api/appointments/$id', body: {'status': status.wire});
  }

  /// API: POST /api/appointments
  Future<Appointment> create(Map<String, dynamic> payload) async {
    final data = await ctx.api.post('/api/appointments', body: payload);
    return Appointment.fromJson(_asMap(data));
  }

  /// API: GET /api/appointments/availability?date=&serviceId=
  /// Devolve os horários livres calculados pelo motor de agenda do backend.
  Future<List<DateTime>> availability(DateTime date, String serviceId) async {
    if (ctx.demoMode) return const [];
    final data = await ctx.api.get('/api/appointments/availability', query: {
      'date': _isoDate(date),
      'serviceId': serviceId,
    });
    return _asList(data)
        .map((e) => DateTime.tryParse((e['startAt'] ?? '').toString())?.toLocal())
        .whereType<DateTime>()
        .toList();
  }
}

class ShiftRepository {
  final RepositoryContext ctx;
  ShiftRepository(this.ctx);

  /// API: GET /api/business-hours?date=YYYY-MM-DD
  /// Traduzir a resposta (dayOfWeek, opensAt, closesAt em minutos) para WorkShift.
  Future<WorkShift> forDate(DateTime date) async {
    if (ctx.demoMode) return SampleData.shiftFor(date);
    final data = await ctx.api
        .get('/api/business-hours', query: {'date': _isoDate(date)});
    final map = _asMap(data);
    if (map.isEmpty) return WorkShift.initial(date);
    return WorkShift(
      date: DateTime(date.year, date.month, date.day),
      state: (map['open'] as bool? ?? false) ? ShiftState.open : ShiftState.closed,
      hours: TimeRange(
        (map['opensAt'] as num?)?.toInt() ?? 9 * 60,
        (map['closesAt'] as num?)?.toInt() ?? 19 * 60,
      ),
      slotMinutes: (map['slotMinutes'] as num?)?.toInt() ?? 30,
    );
  }

  /// API: PUT /api/business-hours
  /// Enviado ao abrir o expediente e ao programar o dia seguinte. É o que o
  /// agente do WhatsApp lê para saber quais horários pode oferecer.
  Future<void> save(WorkShift shift) async {
    if (ctx.demoMode) return;
    await ctx.api.put('/api/business-hours', body: {
      'date': _isoDate(shift.date),
      'open': shift.state == ShiftState.open,
      'opensAt': shift.hours.startMinutes,
      'closesAt': shift.hours.endMinutes,
      'slotMinutes': shift.slotMinutes,
      'breaks': shift.breaks
          .map((b) => {
                'startsAt': b.range.startMinutes,
                'endsAt': b.range.endMinutes,
                'label': b.label,
              })
          .toList(),
      'activeServiceIds': shift.activeServiceIds.toList(),
    });
  }

  /// API: POST /api/shift/open
  /// Dispara o aviso automático de abertura para os clientes do dia.
  /// Quem envia a mensagem é a automação (n8n) — o painel só sinaliza.
  Future<void> openShift(WorkShift shift, {required bool broadcast}) async {
    if (ctx.demoMode) return;
    await ctx.api.post('/api/shift/open', body: {
      'date': _isoDate(shift.date),
      'opensAt': shift.hours.startMinutes,
      'closesAt': shift.hours.endMinutes,
      'slotMinutes': shift.slotMinutes,
      'notifyCustomers': broadcast,
    });
  }

  /// API: POST /api/shift/close  body { date, tomorrow: {...} }
  Future<void> closeShift(WorkShift today, WorkShift? tomorrow) async {
    if (ctx.demoMode) return;
    await ctx.api.post('/api/shift/close', body: {
      'date': _isoDate(today.date),
      if (tomorrow != null)
        'tomorrow': {
          'date': _isoDate(tomorrow.date),
          'open': tomorrow.state != ShiftState.closed,
          'opensAt': tomorrow.hours.startMinutes,
          'closesAt': tomorrow.hours.endMinutes,
          'slotMinutes': tomorrow.slotMinutes,
        },
    });
  }
}

class MetricsRepository {
  final RepositoryContext ctx;
  MetricsRepository(this.ctx);

  /// API: GET /api/metrics?month=YYYY-MM&compareTo=YYYY-MM
  Future<DashboardMetrics> monthly(DateTime month, DateTime compareTo) async {
    if (ctx.demoMode) return SampleData.metrics();
    final data = await ctx.api.get('/api/metrics', query: {
      'month': _isoMonth(month),
      'compareTo': _isoMonth(compareTo),
    });
    return DashboardMetrics.fromJson(_asMap(data));
  }
}

class SettingsRepository {
  final RepositoryContext ctx;
  SettingsRepository(this.ctx);

  /// API: GET /api/settings — configurações do agente de IA e automações.
  Future<AgentSettings> load() async {
    if (ctx.demoMode) return const AgentSettings();
    final data = await ctx.api.get('/api/settings');
    return AgentSettings.fromJson(_asMap(data));
  }

  /// API: PUT /api/settings
  /// A automação do n8n lê estas flags para decidir o comportamento do bot:
  /// enviar lembrete, cobrar antecipado, oferecer upsell, gravar no Google
  /// Agenda e aceitar comandos por voz do dono.
  Future<AgentSettings> save(AgentSettings settings) async {
    if (ctx.demoMode) return settings;
    final data = await ctx.api.put('/api/settings', body: settings.toJson());
    return AgentSettings.fromJson(_asMap(data));
  }
}

Map<String, dynamic> _asMap(dynamic data) {
  if (data is Map<String, dynamic>) {
    final inner = data['data'];
    if (inner is Map<String, dynamic>) return inner;
    return data;
  }
  return const {};
}

List<Map<String, dynamic>> _asList(dynamic data) {
  if (data is List) return data.whereType<Map<String, dynamic>>().toList();
  if (data is Map<String, dynamic>) {
    for (final key in ['data', 'items', 'results']) {
      final inner = data[key];
      if (inner is List) return inner.whereType<Map<String, dynamic>>().toList();
    }
  }
  return const [];
}

String _isoDate(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

String _isoMonth(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}';
