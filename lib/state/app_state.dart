import 'dart:async';

import 'package:flutter/widgets.dart';

import '../api/api_client.dart';
import '../api/repositories.dart';
import '../api/sample_data.dart';
import '../models/models.dart';

enum LoadStatus { idle, loading, ready, failed }

class AppState extends ChangeNotifier {
  AppState({ApiClient? client})
      : _ctx = RepositoryContext(api: client ?? ApiClient()) {
    auth = AuthRepository(_ctx);
    services = ServiceRepository(_ctx);
    schedule = ScheduleRepository(_ctx);
    shifts = ShiftRepository(_ctx);
    metricsRepo = MetricsRepository(_ctx);
    settingsRepo = SettingsRepository(_ctx);
    // Se há sessão guardada (web), o app abre num splash até o restore terminar,
    // em vez de piscar a tela de login.
    _restoring = _ctx.api.hasStoredSession;
  }

  final RepositoryContext _ctx;
  late final AuthRepository auth;
  late final ServiceRepository services;
  late final ScheduleRepository schedule;
  late final ShiftRepository shifts;
  late final MetricsRepository metricsRepo;
  late final SettingsRepository settingsRepo;

  bool _isDark = true;
  Session? _session;
  bool _demoMode = false;
  bool _restoring = false;

  LoadStatus _status = LoadStatus.idle;
  String? _errorMessage;
  bool _sessionExpired = false;
  bool _refreshing = false;
  DateTime? _lastSyncedAt;

  DateTime _selectedDate = _today();
  DateTime _visibleMonth = DateTime(_today().year, _today().month);

  List<ServiceItem> _serviceList = const [];
  List<Appointment> _appointments = const [];
  Set<int> _bookedDays = const {};
  WorkShift _shift = WorkShift.initial(_today());
  WorkShift? _tomorrowPlan;
  AgentSettings _settings = const AgentSettings();
  DashboardMetrics _metrics = const DashboardMetrics();
  List<AppNotification> _notifications = const [];

  bool get isDark => _isDark;
  bool get isSignedIn => _session != null;
  bool get demoMode => _demoMode;
  bool get isRestoringSession => _restoring;
  Session? get session => _session;
  LoadStatus get status => _status;
  String? get errorMessage => _errorMessage;
  bool get isRefreshing => _refreshing;
  DateTime? get lastSyncedAt => _lastSyncedAt;
  bool get isLoading => _status == LoadStatus.loading;

  DateTime get selectedDate => _selectedDate;
  DateTime get visibleMonth => _visibleMonth;
  List<ServiceItem> get serviceList => _serviceList;
  List<ServiceItem> get activeServices =>
      _serviceList.where((s) => s.active).toList();
  List<Appointment> get appointments => _appointments;
  Set<int> get bookedDays => _bookedDays;
  WorkShift get shift => _shift;
  WorkShift? get tomorrowPlan => _tomorrowPlan;
  AgentSettings get settings => _settings;
  DashboardMetrics get metrics => _metrics;
  List<AppNotification> get notifications => _notifications;
  int get unreadCount => _notifications.where((n) => !n.read).length;

  bool get isToday => _isSameDay(_selectedDate, _today());
  bool get shiftOpen => _shift.state == ShiftState.open;

  List<Appointment> get bookedAppointments => _appointments
      .where((a) => a.status != AppointmentStatus.cancelled)
      .toList()
    ..sort((a, b) => a.startAt.compareTo(b.startAt));

  int get expectedRevenueCents => bookedAppointments
      .where((a) => a.status != AppointmentStatus.noShow)
      .fold(0, (sum, a) => sum + a.priceCents);

  int get confirmedRevenueCents => bookedAppointments
      .where((a) => a.status == AppointmentStatus.completed)
      .fold(0, (sum, a) => sum + a.priceCents);

  void toggleTheme() {
    _isDark = !_isDark;
    notifyListeners();
  }

  Future<void> signIn(
    String email,
    String password, {
    bool keepSignedIn = true,
  }) async {
    _status = LoadStatus.loading;
    _errorMessage = null;
    notifyListeners();
    try {
      _ctx.demoMode = false;
      _demoMode = false;
      _session = await auth.signIn(email, password, keepSignedIn: keepSignedIn);
      await _loadWorkspace();
      _status = LoadStatus.ready;
    } on ApiException catch (e) {
      _errorMessage = e.message;
      _status = LoadStatus.failed;
      _session = null;
    }
    notifyListeners();
  }

  /// Chamado uma vez no boot. Se havia sessão guardada e ela ainda vale, entra
  /// direto no painel; senão cai na tela de login sem alarde.
  Future<void> restoreSession() async {
    if (!_restoring) return;
    try {
      final restored = await auth.restore();
      if (restored != null && restored.token.isNotEmpty) {
        _session = restored;
        _status = LoadStatus.loading;
        notifyListeners();
        await _loadWorkspace();
        _status = LoadStatus.ready;
      }
    } on ApiException {
      _session = null;
    } finally {
      _restoring = false;
      notifyListeners();
    }
  }

  Future<void> enterDemoMode() async {
    _ctx.demoMode = true;
    _demoMode = true;
    _errorMessage = null;
    _session = const Session(
      token: '',
      businessId: 'demo',
      businessName: 'Barbearia Demonstração',
      userName: 'Operador',
      userEmail: 'demo@convexa.app',
    );
    _status = LoadStatus.loading;
    notifyListeners();
    await _loadWorkspace();
    _notifications = SampleData.notifications(_selectedDate);
    _status = LoadStatus.ready;
    notifyListeners();
  }

  void signOut({String? message}) {
    // Logout explícito do usuário (sem `message`): avisa o servidor para
    // revogar o refresh token, sem bloquear a saída se a rede falhar.
    if (message == null && !_demoMode) {
      unawaited(auth.signOutRemote());
    }
    auth.signOut();
    _ctx.demoMode = false;
    _demoMode = false;
    _restoring = false;
    _session = null;
    _status = message == null ? LoadStatus.idle : LoadStatus.failed;
    _errorMessage = message;
    _sessionExpired = false;
    _refreshing = false;
    _lastSyncedAt = null;
    _serviceList = const [];
    _appointments = const [];
    _bookedDays = const {};
    _notifications = const [];
    _shift = WorkShift.initial(_today());
    _tomorrowPlan = null;
    _selectedDate = _today();
    _visibleMonth = DateTime(_today().year, _today().month);
    notifyListeners();
  }

  /// Token recusado no meio da sessão: derruba o acesso em vez de deixar o
  /// painel mostrando tela vazia como se não houvesse dado.
  bool _handleAuthFailure(ApiException e) {
    if (!e.isUnauthorized || _demoMode) return false;
    _sessionExpired = true;
    return true;
  }

  /// Falha numa ação de escrita: se o token morreu, derruba a sessão em vez de
  /// deixar o usuário tentando salvar num painel que já não tem acesso.
  String _mutationError(ApiException e) {
    if (e.isUnauthorized && !_demoMode) {
      signOut(message: 'Sua sessão expirou. Entre novamente.');
    }
    return e.message;
  }

  void _finishLoadCycle() {
    if (_sessionExpired) {
      _sessionExpired = false;
      signOut(message: 'Sua sessão expirou. Entre novamente.');
      return;
    }
    _lastSyncedAt = DateTime.now();
  }

  Future<void> _loadWorkspace() async {
    await Future.wait([
      _loadServices(),
      _loadDay(_selectedDate),
      _loadMonth(_visibleMonth),
      _loadSettings(),
      _loadMetrics(),
    ]);
    _finishLoadCycle();
  }

  Future<void> refresh() async {
    if (_refreshing) return;
    _refreshing = true;
    notifyListeners();
    await _loadWorkspace();
    _refreshing = false;
    if (_session != null) _status = LoadStatus.ready;
    notifyListeners();
  }

  Future<void> _loadServices() async {
    try {
      _serviceList = await services.list();
    } on ApiException catch (e) {
      _handleAuthFailure(e);
      _serviceList = const [];
    }
  }

  Future<void> _loadDay(DateTime date) async {
    try {
      _appointments = await schedule.byDate(date);
    } on ApiException catch (e) {
      _handleAuthFailure(e);
      _appointments = const [];
    }
    try {
      final loaded = await shifts.forDate(date);
      _shift = loaded.copyWith(
        activeServiceIds: loaded.activeServiceIds.isEmpty
            ? _serviceList.where((s) => s.active).map((s) => s.id).toSet()
            : loaded.activeServiceIds,
      );
    } on ApiException catch (e) {
      _handleAuthFailure(e);
      _shift = WorkShift.initial(date).copyWith(
        activeServiceIds:
            _serviceList.where((s) => s.active).map((s) => s.id).toSet(),
      );
    }
  }

  Future<void> _loadMonth(DateTime month) async {
    try {
      _bookedDays = await schedule.bookedDaysOfMonth(month);
    } on ApiException catch (e) {
      _handleAuthFailure(e);
      _bookedDays = const {};
    }
  }

  Future<void> _loadSettings() async {
    try {
      _settings = await settingsRepo.load();
    } on ApiException catch (e) {
      _handleAuthFailure(e);
      _settings = const AgentSettings();
    }
  }

  Future<void> _loadMetrics() async {
    final now = DateTime.now();
    try {
      _metrics = await metricsRepo.monthly(
        DateTime(now.year, now.month),
        DateTime(now.year, now.month - 1),
      );
    } on ApiException catch (e) {
      _handleAuthFailure(e);
      _metrics = const DashboardMetrics();
    }
  }

  /// Selecionar um dia de outro mês precisa arrastar o calendário junto,
  /// senão o painel mostra "Amanhã" enquanto o calendário fica no mês velho.
  Future<void> selectDate(DateTime date) async {
    _selectedDate = DateTime(date.year, date.month, date.day);
    final monthChanged = _visibleMonth.year != date.year ||
        _visibleMonth.month != date.month;
    if (monthChanged) _visibleMonth = DateTime(date.year, date.month);
    notifyListeners();
    await _loadDay(_selectedDate);
    if (monthChanged) await _loadMonth(_visibleMonth);
    _finishLoadCycle();
    notifyListeners();
  }

  Future<void> showMonth(DateTime month) async {
    _visibleMonth = DateTime(month.year, month.month);
    notifyListeners();
    await _loadMonth(_visibleMonth);
    _finishLoadCycle();
    notifyListeners();
  }

  bool get canOpenShift =>
      _shift.hours.isValid &&
      _shift.activeServiceIds.isNotEmpty &&
      _shift.state != ShiftState.open;

  String? get openBlockReason {
    if (_shift.state == ShiftState.open) return 'O expediente já está aberto.';
    if (!_shift.hours.isValid) {
      return 'O horário de encerramento precisa ser depois do de abertura.';
    }
    if (_shift.activeServiceIds.isEmpty) {
      return 'Ative pelo menos um serviço antes de abrir.';
    }
    return null;
  }

  void updateShiftHours(TimeRange hours) {
    _shift = _shift.copyWith(hours: hours);
    notifyListeners();
  }

  void updateSlotMinutes(int minutes) {
    _shift = _shift.copyWith(slotMinutes: minutes);
    notifyListeners();
  }

  void toggleShiftService(String serviceId) {
    final next = Set<String>.from(_shift.activeServiceIds);
    if (!next.remove(serviceId)) next.add(serviceId);
    _shift = _shift.copyWith(activeServiceIds: next);
    notifyListeners();
  }

  /// Devolve o motivo pelo qual a pausa não pode entrar, ou null se estiver
  /// livre. Checa contra a janela do dia, outras pausas e horários já marcados.
  String? validateBreak(TimeRange range) {
    if (!range.isValid) return 'O fim precisa ser depois do início.';
    if (range.startMinutes < _shift.hours.startMinutes ||
        range.endMinutes > _shift.hours.endMinutes) {
      return 'A pausa precisa caber dentro do horário de atendimento.';
    }
    for (final b in _shift.breaks) {
      if (range.startMinutes < b.range.endMinutes &&
          b.range.startMinutes < range.endMinutes) {
        return 'Esse intervalo já está ocupado pela pausa "${b.label}".';
      }
    }
    for (final a in bookedAppointments) {
      final start = a.startAt.hour * 60 + a.startAt.minute;
      final end = start + a.durationMinutes;
      if (range.startMinutes < end && start < range.endMinutes) {
        return '${a.customerName} tem horário marcado nesse intervalo.';
      }
    }
    return null;
  }

  String? addBreak(TimeRange range, String label) {
    final problem = validateBreak(range);
    if (problem != null) return problem;
    final next = List<ShiftBreak>.from(_shift.breaks)
      ..add(ShiftBreak(
        id: 'brk-${DateTime.now().microsecondsSinceEpoch}',
        range: range,
        label: label,
      ))
      ..sort((a, b) => a.range.startMinutes.compareTo(b.range.startMinutes));
    _shift = _shift.copyWith(breaks: next);
    notifyListeners();
    return null;
  }

  void removeBreak(String id) {
    _shift = _shift.copyWith(
      breaks: _shift.breaks.where((b) => b.id != id).toList(),
    );
    notifyListeners();
  }

  /// Grava a janela do dia como a faixa semanal daquele dia da semana, que é
  /// como o backend guarda horário. Abrir/encerrar em si é estado de tela: a
  /// API ainda não tem o conceito de expediente do dia.
  Future<void> _persistHours(WorkShift shift) async {
    await shifts.saveWeeklyHours([
      {
        'dayOfWeek': shift.date.weekday % 7,
        'opensAt': shift.hours.startMinutes,
        'closesAt': shift.hours.endMinutes,
      },
    ]);
    for (final b in shift.breaks) {
      final day = shift.date;
      await shifts.addTimeBlock(
        day.add(Duration(minutes: b.range.startMinutes)),
        day.add(Duration(minutes: b.range.endMinutes)),
        reason: b.label,
      );
    }
  }

  Future<String?> openShift() async {
    final blocked = openBlockReason;
    if (blocked != null) return blocked;
    final next = _shift.copyWith(
      state: ShiftState.open,
      openedAt: DateTime.now(),
    );
    _shift = next;
    notifyListeners();
    try {
      await _persistHours(next);
      return null;
    } on ApiException catch (e) {
      _shift = next.copyWith(state: ShiftState.closed);
      notifyListeners();
      return _mutationError(e);
    }
  }

  Future<String?> closeShift({WorkShift? tomorrow}) async {
    final previous = _shift;
    final next = _shift.copyWith(
      state: ShiftState.finished,
      closedAt: DateTime.now(),
    );
    _shift = next;
    _tomorrowPlan = tomorrow;
    notifyListeners();
    try {
      if (tomorrow != null) {
        if (tomorrow.state == ShiftState.closed) {
          await shifts.closeDay(tomorrow.date, reason: 'Folga');
        } else {
          await _persistHours(tomorrow);
        }
      }
      return null;
    } on ApiException catch (e) {
      _shift = previous;
      notifyListeners();
      return _mutationError(e);
    }
  }

  Future<String?> reopenShift() async {
    final previous = _shift;
    final next = _shift.copyWith(state: ShiftState.open, closedAt: null);
    _shift = next;
    notifyListeners();
    try {
      await _persistHours(next);
      return null;
    } on ApiException catch (e) {
      _shift = previous;
      notifyListeners();
      return _mutationError(e);
    }
  }

  Future<String?> setAppointmentStatus(
      String id, AppointmentStatus status) async {
    final index = _appointments.indexWhere((a) => a.id == id);
    if (index < 0) return null;
    final previous = _appointments;
    final next = List<Appointment>.from(_appointments);
    next[index] = next[index].copyWith(status: status);
    _appointments = next;
    notifyListeners();
    try {
      await schedule.setStatus(id, status);
      return null;
    } on ApiException catch (e) {
      _appointments = previous;
      notifyListeners();
      return _mutationError(e);
    }
  }

  Future<String?> saveService(ServiceItem service) async {
    try {
      if (service.id.isEmpty) {
        final created = await services.create(service);
        _serviceList = [..._serviceList, created];
      } else {
        final updated = await services.update(service);
        _serviceList = _serviceList
            .map((s) => s.id == updated.id ? updated : s)
            .toList();
      }
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      return _mutationError(e);
    }
  }

  Future<String?> deleteService(String id) async {
    final previous = _serviceList;
    _serviceList = _serviceList.where((s) => s.id != id).toList();
    notifyListeners();
    try {
      await services.remove(id);
      return null;
    } on ApiException catch (e) {
      _serviceList = previous;
      notifyListeners();
      return _mutationError(e);
    }
  }

  Future<String?> saveSettings(AgentSettings next) async {
    final previous = _settings;
    _settings = next;
    notifyListeners();
    try {
      _settings = await settingsRepo.save(next);
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      _settings = previous;
      notifyListeners();
      return _mutationError(e);
    }
  }

  void markNotificationsRead() {
    _notifications = _notifications
        .map((n) => AppNotification(
              id: n.id,
              title: n.title,
              body: n.body,
              createdAt: n.createdAt,
              appointment: n.appointment,
              read: true,
            ))
        .toList();
    notifyListeners();
  }

  void dismissNotification(String id) {
    _notifications = _notifications.where((n) => n.id != id).toList();
    notifyListeners();
  }

  static DateTime _today() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  static bool _isSameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;
}

class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child})
      : super(notifier: state);

  static AppState of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope não encontrado na árvore de widgets.');
    return scope!.notifier!;
  }

  static AppState read(BuildContext context) {
    final scope = context.getInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope não encontrado na árvore de widgets.');
    return scope!.notifier!;
  }
}
