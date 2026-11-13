import 'repositories.dart';

/// Um intervalo de trabalho num dia da semana (0 = domingo), em minutos do dia.
class WorkRange {
  final int day;
  final int start;
  final int end;
  const WorkRange(this.day, this.start, this.end);

  Map<String, int> toJson() => {'dayOfWeek': day, 'startsAt': start, 'endsAt': end};
}

/// Profissional da equipe (Employee na ConvexaAPI).
class TeamMember {
  final String id;
  final String name;
  final bool active;
  final List<String> serviceIds;
  final List<WorkRange> hours;

  const TeamMember({
    required this.id,
    required this.name,
    required this.active,
    required this.serviceIds,
    required this.hours,
  });

  factory TeamMember.fromJson(Map<String, dynamic> j) => TeamMember(
        id: j['id'].toString(),
        name: (j['name'] ?? '').toString(),
        active: j['active'] != false,
        serviceIds: [
          for (final s in (j['services'] as List? ?? const []))
            if (s is Map) s['serviceId'].toString() else s.toString(),
        ],
        hours: [
          for (final h in (j['hours'] as List? ?? const []))
            if (h is Map)
              WorkRange(
                (h['dayOfWeek'] as num).toInt(),
                (h['startsAt'] as num).toInt(),
                (h['endsAt'] as num).toInt(),
              ),
        ],
      );
}

/// API: /api/employees (lista, cria, edita, serviços e horários de cada um).
class TeamRepository {
  final RepositoryContext ctx;
  TeamRepository(this.ctx);

  static final List<TeamMember> _demo = [
    TeamMember(id: 'demo-lucas', name: 'Lucas', active: true, serviceIds: const [], hours: _week(9 * 60, 19 * 60, lunch: true)),
    TeamMember(id: 'demo-pedro', name: 'Pedro', active: true, serviceIds: const [], hours: _week(10 * 60, 20 * 60)),
  ];

  static List<WorkRange> _week(int start, int end, {bool lunch = false}) => [
        for (var d = 1; d <= 6; d++)
          ...(lunch ? [WorkRange(d, start, 12 * 60), WorkRange(d, 13 * 60, end)] : [WorkRange(d, start, end)]),
      ];

  Future<List<TeamMember>> list() async {
    if (ctx.demoMode) return List.of(_demo);
    final data = await ctx.api.get('/api/employees', query: {'includeInactive': 'true', 'perPage': '100'});
    final items = data is Map ? (data['data'] as List? ?? const []) : (data as List? ?? const []);
    return [for (final e in items) if (e is Map) TeamMember.fromJson(Map<String, dynamic>.from(e))]
      ..sort((a, b) => a.active == b.active ? a.name.compareTo(b.name) : (a.active ? -1 : 1));
  }

  static List<WorkRange> _demoBusiness = _week(9 * 60, 19 * 60);

  /// Horário de funcionamento do estabelecimento. A agenda só oferece horário
  /// na interseção dele com o horário de cada profissional.
  Future<List<WorkRange>> businessHours() async {
    if (ctx.demoMode) return List.of(_demoBusiness);
    final b = await ctx.api.get('/api/business');
    final map = b is Map && b['data'] is Map ? b['data'] as Map : (b as Map? ?? const {});
    return [
      for (final h in (map['hours'] as List? ?? const []))
        if (h is Map) WorkRange((h['dayOfWeek'] as num).toInt(), (h['opensAt'] as num).toInt(), (h['closesAt'] as num).toInt()),
    ];
  }

  /// API: PUT /api/business/hours (substitui a semana inteira).
  Future<void> saveBusinessHours(List<WorkRange> hours) async {
    if (ctx.demoMode) {
      _demoBusiness = List.of(hours);
      return;
    }
    await ctx.api.put('/api/business/hours', body: {
      'hours': [
        for (final h in hours) {'dayOfWeek': h.day, 'opensAt': h.start, 'closesAt': h.end},
      ],
    });
  }

  Future<void> create({required String name, required List<String> serviceIds, required List<WorkRange> hours}) async {
    if (ctx.demoMode) {
      _demo.add(TeamMember(id: 'demo-${_demo.length}', name: name, active: true, serviceIds: serviceIds, hours: hours));
      return;
    }
    await ctx.api.post('/api/employees', body: {
      'name': name,
      'serviceIds': serviceIds,
      'hours': [for (final h in hours) h.toJson()],
    });
  }

  Future<void> update(TeamMember before, {required String name, required bool active, required List<String> serviceIds, required List<WorkRange> hours}) async {
    if (ctx.demoMode) {
      final i = _demo.indexWhere((m) => m.id == before.id);
      if (i >= 0) _demo[i] = TeamMember(id: before.id, name: name, active: active, serviceIds: serviceIds, hours: hours);
      return;
    }
    final id = before.id;
    if (name != before.name || active != before.active) {
      await ctx.api.patch('/api/employees/$id', body: {'name': name, 'active': active});
    }
    await ctx.api.put('/api/employees/$id/services', body: {'serviceIds': serviceIds});
    await ctx.api.put('/api/employees/$id/hours', body: {'hours': [for (final h in hours) h.toJson()]});
  }

  /// DELETE /api/employees/:id só desativa (não existe exclusão definitiva).
  Future<void> deactivate(String id) async {
    if (ctx.demoMode) {
      _demo.removeWhere((m) => m.id == id);
      return;
    }
    await ctx.api.delete('/api/employees/$id');
  }
}
