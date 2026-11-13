import '../models/models.dart';
import 'api_client.dart';
import 'sample_data.dart';

/// Quando `demoMode` é true o painel opera com um conjunto local de dados
/// para demonstração, sem tocar na API. Ele é ligado pelo botão
/// "Explorar em modo demonstração" na tela de login.
class RepositoryContext {
  final ApiClient api;
  bool demoMode;

  RepositoryContext({required this.api, this.demoMode = false});
}

class AuthRepository {
  final RepositoryContext ctx;
  AuthRepository(this.ctx);

  /// API: POST /api/auth/login
  /// body { email, password } -> { accessToken, refreshToken, user, business }
  ///
  /// `keepSignedIn` liga o "continuar conectado": grava os tokens no
  /// `localStorage` (só no Flutter Web) para sobreviver a um recarregamento.
  Future<Session> signIn(
    String email,
    String password, {
    bool keepSignedIn = true,
  }) async {
    final data = await ctx.api.post(
      '/api/auth/login',
      body: {'email': email.trim(), 'password': password},
      allowRefresh: false,
    );
    final session = Session.fromJson(_asMap(data));
    if (session.token.isEmpty) {
      throw const ApiException(500, 'A API não devolveu um token de acesso.');
    }
    ctx.api.setSession(
      session.token,
      session.refreshToken,
      persist: keepSignedIn,
    );
    return session;
  }

  /// API: POST /api/auth/register
  /// body { business: { name, slug, timezone }, owner: { name, email, password } }
  Future<Session> register({
    required String businessName,
    required String businessSlug,
    required String ownerName,
    required String email,
    required String password,
    String timezone = 'America/Sao_Paulo',
  }) async {
    final data = await ctx.api.post(
      '/api/auth/register',
      body: {
        'business': {
          'name': businessName,
          'slug': businessSlug,
          'timezone': timezone,
        },
        'owner': {
          'name': ownerName,
          'email': email.trim(),
          'password': password,
        },
      },
      allowRefresh: false,
    );
    final session = Session.fromJson(_asMap(data));
    if (session.token.isNotEmpty) {
      ctx.api.setSession(session.token, session.refreshToken);
    }
    return session;
  }

  /// API: GET /api/auth/me — devolve { user, business } (sem tokens).
  Future<Session> me() async {
    final data = await ctx.api.get('/api/auth/me');
    return Session.fromJson(_asMap(data));
  }

  /// Reidrata a sessão guardada ao abrir o painel. O access token pode já ter
  /// expirado (15 min) — o `ApiClient` troca pelo refresh sozinho na chamada a
  /// `/api/auth/me`. Devolve `null` se não há sessão válida.
  Future<Session?> restore() async {
    if (!ctx.api.hasStoredSession) return null;
    try {
      final me = _asMap(await ctx.api.get('/api/auth/me'));
      return Session.fromJson({
        ...me,
        'accessToken': ctx.api.token,
        'refreshToken': ctx.api.refreshTokenValue,
      });
    } on ApiException {
      ctx.api.clearSession();
      return null;
    }
  }

  /// API: POST /api/auth/logout — exige Bearer + { refreshToken } no corpo.
  Future<void> signOutRemote() async {
    final rt = ctx.api.refreshTokenValue;
    if (rt == null || rt.isEmpty) return;
    try {
      await ctx.api.post(
        '/api/auth/logout',
        body: {'refreshToken': rt},
        allowRefresh: false,
      );
    } on ApiException {
      // Sair localmente vale mesmo se o servidor não responder.
    }
  }

  void signOut() => ctx.api.clearSession();
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

  /// API: GET /api/appointments?from=&to=
  /// A rota filtra por instante ISO-8601 com fuso, não por data solta.
  Future<List<Appointment>> byDate(DateTime date) async {
    if (ctx.demoMode) return SampleData.appointmentsFor(date);
    final start = DateTime(date.year, date.month, date.day);
    return _range(start, start.add(const Duration(days: 1)));
  }

  Future<List<Appointment>> _range(DateTime from, DateTime to) async {
    final data = await ctx.api.get('/api/appointments', query: {
      'from': _instant(from),
      'to': _instant(to),
    });
    return _asList(data).map(Appointment.fromJson).toList();
  }

  /// API: GET /api/appointments?from=&to=
  /// Usado para marcar no calendário quais dias do mês têm agendamento.
  Future<Set<int>> bookedDaysOfMonth(DateTime month) async {
    if (ctx.demoMode) return SampleData.bookedDays(month);
    final first = DateTime(month.year, month.month, 1);
    final afterLast = DateTime(month.year, month.month + 1, 1);
    final appointments = await _range(first, afterLast);
    return appointments.map((a) => a.startAt.day).toSet();
  }

  /// Mudança de status. O backend expõe uma ação por rota, em vez de um PATCH
  /// genérico com `status` no corpo — assim cada transição tem sua regra
  /// (cancelar libera o horário; concluir conta na receita).
  ///
  /// API: POST /api/appointments/:id/confirm
  /// API: POST /api/appointments/:id/complete
  /// API: POST /api/appointments/:id/cancel
  ///
  /// NO_SHOW ainda não existe no enum do backend (só SCHEDULED, CONFIRMED,
  /// COMPLETED e CANCELLED). Enquanto não entrar, marcar falta fora do modo
  /// demonstração é recusado aqui em vez de bater numa rota inexistente.
  Future<void> setStatus(String id, AppointmentStatus status) async {
    if (ctx.demoMode) return;
    final action = switch (status) {
      AppointmentStatus.confirmed => 'confirm',
      AppointmentStatus.completed => 'complete',
      AppointmentStatus.cancelled => 'cancel',
      AppointmentStatus.noShow => null,
      AppointmentStatus.scheduled => null,
    };
    if (action == null) {
      throw ApiException(
        501,
        status == AppointmentStatus.noShow
            ? 'Registrar falta ainda não existe na API. Use "Cancelar horário" por enquanto.'
            : 'Não há ação para voltar um horário a "aguardando".',
      );
    }
    await ctx.api.post('/api/appointments/$id/$action');
  }

  /// API: PATCH /api/appointments/:id/reschedule
  /// body { startAt, employeeId? } — o backend revalida a disponibilidade,
  /// então remarcar para um horário ocupado é recusado por ele, não por nós.
  Future<Appointment> reschedule(
    String id,
    DateTime startAt, {
    String? employeeId,
  }) async {
    final data = await ctx.api.patch(
      '/api/appointments/$id/reschedule',
      body: {
        'startAt': _instant(startAt),
        if (employeeId != null) 'employeeId': employeeId,
      },
    );
    return Appointment.fromJson(_asMap(data));
  }

  /// API: POST /api/appointments
  /// Exige customerId, serviceId e employeeId — todos UUID. Para criar a
  /// partir de um telefone, resolver o cliente antes em
  /// POST /api/customers/resolve.
  Future<Appointment> create({
    required String customerId,
    required String serviceId,
    required String employeeId,
    required DateTime startAt,
    String? notes,
  }) async {
    final data = await ctx.api.post('/api/appointments', body: {
      'customerId': customerId,
      'serviceId': serviceId,
      'employeeId': employeeId,
      'startAt': _instant(startAt),
      if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
    });
    return Appointment.fromJson(_asMap(data));
  }

  /// API: GET /api/availability?serviceId=&date=&employeeId=&limit=
  /// Devolve `{ date, serviceId, durationMinutes, totalSlots, slots: [...] }`.
  /// Cada slot é `{ employeeId, startAt, endAt }` com instante ISO-8601.
  Future<List<DateTime>> availability(
    DateTime date,
    String serviceId, {
    String? employeeId,
    int limit = 20,
  }) async {
    if (ctx.demoMode) return const [];
    final data = _asMap(await ctx.api.get('/api/availability', query: {
      'serviceId': serviceId,
      'date': _isoDate(date),
      if (employeeId != null) 'employeeId': employeeId,
      'limit': limit,
    }));
    final slots = data['slots'];
    if (slots is! List) return const [];
    return slots
        .whereType<Map>()
        .map((e) =>
            DateTime.tryParse((e['startAt'] ?? e['start'] ?? '').toString())
                ?.toLocal())
        .whereType<DateTime>()
        .toList();
  }
}

class CustomerRepository {
  final RepositoryContext ctx;
  CustomerRepository(this.ctx);

  /// API: POST /api/customers/resolve
  /// body { phone, name? } -> acha o cliente pelo telefone ou cria um novo.
  /// É o primeiro passo do agente antes de marcar qualquer horário.
  Future<String> resolveByPhone(String phone, {String? name}) async {
    final data = await ctx.api.post('/api/customers/resolve', body: {
      'phone': phone.trim(),
      if (name != null && name.trim().isNotEmpty) 'name': name.trim(),
    });
    return (_asMap(data)['id'] ?? '').toString();
  }
}

class ShiftRepository {
  final RepositoryContext ctx;
  ShiftRepository(this.ctx);

  /// API: GET /api/business
  /// Devolve o negócio com `hours` (grade semanal), `closedDays` e
  /// `vacations`. O expediente do dia é derivado disso: procura a faixa do
  /// dia da semana e checa se a data caiu num dia fechado.
  Future<WorkShift> forDate(DateTime date) async {
    if (ctx.demoMode) return SampleData.shiftFor(date);

    final data = _asMap(await ctx.api.get('/api/business'));
    final slot = (data['slotIntervalMinutes'] as num?)?.toInt() ?? 30;

    final closed = (data['closedDays'] as List? ?? const []).any((d) {
      final raw = (d is Map ? d['date'] : null)?.toString() ?? '';
      final parsed = DateTime.tryParse(raw)?.toLocal();
      return parsed != null &&
          parsed.year == date.year &&
          parsed.month == date.month &&
          parsed.day == date.day;
    });

    final weekday = date.weekday % 7;
    final today = (data['hours'] as List? ?? const []).cast<dynamic>().firstWhere(
          (h) => h is Map && (h['dayOfWeek'] as num?)?.toInt() == weekday,
          orElse: () => null,
        );

    if (closed || today == null) {
      return WorkShift.initial(date).copyWith(slotMinutes: slot);
    }

    return WorkShift(
      date: DateTime(date.year, date.month, date.day),
      state: ShiftState.closed,
      hours: TimeRange(
        (today['opensAt'] as num?)?.toInt() ?? 9 * 60,
        (today['closesAt'] as num?)?.toInt() ?? 19 * 60,
      ),
      slotMinutes: slot,
    );
  }

  /// API: PUT /api/business/hours
  /// body { hours: [{ dayOfWeek, opensAt, closesAt }] }
  ///
  /// A grade é SEMANAL, não por data: gravar aqui muda todas as ocorrências
  /// daquele dia da semana. Para fechar uma data específica use closed-days,
  /// e para bloquear um intervalo use time-blocks.
  Future<void> saveWeeklyHours(List<Map<String, int>> hours) async {
    if (ctx.demoMode) return;
    await ctx.api.put('/api/business/hours', body: {'hours': hours});
  }

  /// Troca só o horário de UM dia da semana. O PUT /api/business/hours
  /// substitui a semana inteira, então lê a grade atual, troca aquele dia e
  /// regrava tudo. Antes, abrir o expediente apagava os outros dias.
  Future<void> saveDayHours(int dayOfWeek, int opensAt, int closesAt) async {
    if (ctx.demoMode) return;
    final business = _asMap(await ctx.api.get('/api/business'));
    final current = (business['hours'] as List? ?? const [])
        .whereType<Map>()
        .where((h) => (h['dayOfWeek'] as num?)?.toInt() != dayOfWeek)
        .map((h) => {
              'dayOfWeek': (h['dayOfWeek'] as num).toInt(),
              'opensAt': (h['opensAt'] as num).toInt(),
              'closesAt': (h['closesAt'] as num).toInt(),
            })
        .toList();
    await saveWeeklyHours([
      ...current,
      {'dayOfWeek': dayOfWeek, 'opensAt': opensAt, 'closesAt': closesAt},
    ]);
  }

  /// API: POST /api/business/closed-days
  /// body { date, reason? } — é o "amanhã é folga" da tela de Encerrar.
  Future<void> closeDay(DateTime date, {String? reason}) async {
    if (ctx.demoMode) return;
    await ctx.api.post('/api/business/closed-days', body: {
      'date': _isoDate(date),
      if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
    });
  }

  /// API: POST /api/time-blocks
  /// body { startAt, endAt, reason? } — é onde as pausas do dia (almoço,
  /// café) realmente ficam. Enquanto isto não for chamado, as pausas vivem
  /// só na memória do painel e o agente não sabe delas.
  Future<void> addTimeBlock(
    DateTime startAt,
    DateTime endAt, {
    String? reason,
  }) async {
    if (ctx.demoMode) return;
    await ctx.api.post('/api/time-blocks', body: {
      'startAt': _instant(startAt),
      'endAt': _instant(endAt),
      if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
    });
  }

  /// API: GET /api/time-blocks?from=&to=
  Future<List<Map<String, dynamic>>> timeBlocks(
      DateTime from, DateTime to) async {
    if (ctx.demoMode) return const [];
    final data = await ctx.api.get('/api/time-blocks', query: {
      'from': _instant(from),
      'to': _instant(to),
    });
    return _asList(data);
  }

  /// API: DELETE /api/time-blocks/:id
  Future<void> removeTimeBlock(String id) async {
    if (ctx.demoMode) return;
    await ctx.api.delete('/api/time-blocks/$id');
  }
}

class MetricsRepository {
  final RepositoryContext ctx;
  MetricsRepository(this.ctx);

  /// PENDENTE NO BACKEND: não existe rota de métricas hoje.
  /// Enquanto ela não existir, o painel calcula o mês a partir dos próprios
  /// agendamentos, em vez de mostrar número inventado.
  Future<DashboardMetrics> monthly(DateTime month, DateTime compareTo) async {
    if (ctx.demoMode) return SampleData.metrics();
    return const DashboardMetrics();
  }
}

class SettingsRepository {
  final RepositoryContext ctx;
  SettingsRepository(this.ctx);

  /// API: GET /api/business
  /// As configurações do agente moram no próprio negócio, não numa rota
  /// /settings. Os segredos da Meta (accessToken, appSecret) NÃO voltam nesta
  /// resposta — o backend usa allowlist de campos — e o painel não deve
  /// gravá-los tampouco.
  Future<AgentSettings> load() async {
    if (ctx.demoMode) return const AgentSettings();
    final data = _asMap(await ctx.api.get('/api/business'));
    return AgentSettings(
      agentPhone: (data['metaPhoneNumberId'] ?? '').toString(),
      ownerPhone: (data['phone'] ?? '').toString(),
    );
  }

  /// API: PATCH /api/business
  /// Só envia o que o backend aceita hoje. As demais chaves da tela
  /// (lembrete, pagamento antecipado, upsell, Google Agenda, assistentes de
  /// voz) ainda não têm campo correspondente — ver FUNCIONALIDADES.md.
  Future<AgentSettings> save(AgentSettings settings) async {
    if (ctx.demoMode) return settings;
    final body = <String, dynamic>{};
    if (settings.ownerPhone.trim().isNotEmpty) {
      body['phone'] = settings.ownerPhone.trim();
    }
    if (body.isEmpty) return settings;
    await ctx.api.patch('/api/business', body: body);
    return settings;
  }
}

/// Dados do estabelecimento e a conexão com o WhatsApp (Meta Cloud API).
/// GET devolve só campos públicos; token e app secret são só de escrita
/// (o backend cifra e nunca devolve).
class BusinessRepository {
  final RepositoryContext ctx;
  BusinessRepository(this.ctx);

  static final Map<String, dynamic> _demo = {
    'name': 'Barbearia Demonstração',
    'phone': '+5514999990000',
    'metaPhoneNumberId': '100000000000001',
    'metaWabaId': '200000000000001',
  };

  Future<Map<String, dynamic>> get() async {
    if (ctx.demoMode) return Map.of(_demo);
    return _asMap(await ctx.api.get('/api/business'));
  }

  /// API: PATCH /api/business (só o dono). Manda apenas o que foi preenchido.
  Future<Map<String, dynamic>> update(Map<String, String> fields) async {
    final body = {
      for (final e in fields.entries)
        if (e.value.trim().isNotEmpty) e.key: e.value.trim(),
    };
    if (body.isEmpty) return get();
    if (ctx.demoMode) {
      _demo.addAll({
        for (final e in body.entries)
          if (!e.key.contains('Token') && !e.key.contains('Secret')) e.key: e.value,
      });
      return Map.of(_demo);
    }
    return _asMap(await ctx.api.patch('/api/business', body: body));
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

/// A API exige ISO-8601 com fuso. `toUtc().toIso8601String()` já sai com Z.
String _instant(DateTime d) => d.toUtc().toIso8601String();
