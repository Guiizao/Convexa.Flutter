import 'package:flutter/material.dart';

import '../../api/api_client.dart';
import '../../api/team.dart';
import '../../core/formatters.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';
import '../components/buttons.dart';
import '../components/inputs.dart';
import '../components/motion.dart';
import '../components/primitives.dart';

const _days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const _daysFull = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/// Quem atende, o que cada um faz e em que horário. É daqui que saem os
/// horários livres que o bot oferece no WhatsApp.
class EquipeScreen extends StatefulWidget {
  const EquipeScreen({super.key});

  @override
  State<EquipeScreen> createState() => _EquipeScreenState();
}

class _EquipeScreenState extends State<EquipeScreen> {
  List<TeamMember>? _members;
  List<WorkRange> _businessHours = const [];
  String? _error;
  bool _showInactive = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    try {
      final team = AppScope.read(context).team;
      final list = await team.list();
      final hours = await team.businessHours();
      if (mounted) {
        setState(() {
          _members = list;
          _businessHours = hours;
          _error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _edit([TeamMember? member]) async {
    final state = AppScope.read(context);
    var suggested = const <WorkRange>[];
    if (member == null) {
      try {
        suggested = await state.team.businessHours();
      } catch (_) {
        // sem horário do estabelecimento: o editor sugere seg a sáb, 9h às 18h
      }
    }
    if (!mounted) return;
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => _MemberEditor(member: member, services: state.serviceList, suggestedHours: suggested),
    );
    if (changed == true) await _load();
  }

  Future<void> _editBusinessHours() async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => _BusinessHoursEditor(hours: _businessHours),
    );
    if (changed == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final services = AppScope.of(context).serviceList;
    final members = _members;

    if (members == null && _error != null) {
      return EmptyState(
        icon: Icons.cloud_off_outlined,
        title: 'Não foi possível carregar a equipe',
        message: _error!,
        action: AppButton(label: 'Tentar de novo', variant: ButtonVariant.secondary, onPressed: _load),
      );
    }
    if (members == null) return const LoadingOverlay(message: 'Carregando a equipe');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: Space.lg,
          runSpacing: Space.md,
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: Text(
                'Quem atende, o que cada um faz e em que horário. O bot só oferece horários de quem está ativo aqui.',
                style: AppType.small.copyWith(color: c.t2, height: 1.45),
              ),
            ),
            AppButton(label: 'Adicionar profissional', icon: Icons.person_add_alt_1_outlined, onPressed: () => _edit()),
          ],
        ),
        const SizedBox(height: Space.lg),
        StaggeredEntrance(
          position: 0,
          child: AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SectionHeader(
                  title: 'Horário de funcionamento',
                  subtitle: 'Quando o estabelecimento abre. O horário de cada profissional fica dentro dele.',
                  trailing: AppButton(
                    label: 'Editar',
                    size: ButtonSize.small,
                    variant: ButtonVariant.secondary,
                    icon: Icons.schedule_rounded,
                    onPressed: _editBusinessHours,
                  ),
                ),
                if (_businessHours.isEmpty)
                  const InfoBanner(
                    tone: BannerTone.warning,
                    message: 'Sem horário de funcionamento o bot não oferece nenhum horário. Toque em Editar para cadastrar.',
                  )
                else
                  for (final line in _summary(_businessHours)) Text(line, style: AppType.small.copyWith(color: c.t2, height: 1.5)),
              ],
            ),
          ),
        ),
        const SizedBox(height: Space.lg),
        if (members.where((m) => m.active).isEmpty && !_showInactive)
          AppCard(
            child: EmptyState(
              icon: Icons.groups_outlined,
              title: 'Ninguém na equipe ainda',
              message: 'Cadastre pelo menos um profissional, com os serviços e o horário dele, para o bot ter horários para oferecer.',
              action: AppButton(label: 'Adicionar profissional', onPressed: () => _edit()),
            ),
          )
        else
          ResponsiveGrid(
            minItemWidth: 300,
            spacing: Space.lg,
            runSpacing: Space.lg,
            children: [
              for (final (i, m) in members.where((m) => m.active || _showInactive).indexed)
                StaggeredEntrance(position: i + 1, child: _MemberCard(member: m, services: services, onEdit: () => _edit(m))),
            ],
          ),
        if (members.any((m) => !m.active)) ...[
          const SizedBox(height: Space.md),
          Align(
            alignment: Alignment.centerLeft,
            child: AppButton(
              label: _showInactive ? 'Esconder inativos' : 'Mostrar inativos (${members.where((m) => !m.active).length})',
              size: ButtonSize.small,
              variant: ButtonVariant.ghost,
              icon: _showInactive ? Icons.visibility_off_outlined : Icons.visibility_outlined,
              onPressed: () => setState(() => _showInactive = !_showInactive),
            ),
          ),
        ],
      ],
    );
  }
}

class _MemberCard extends StatelessWidget {
  final TeamMember member;
  final List<ServiceItem> services;
  final VoidCallback onEdit;
  const _MemberCard({required this.member, required this.services, required this.onEdit});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final names = [for (final s in services) if (member.serviceIds.contains(s.id)) s.name];
    return AppCard(
      onTap: onEdit,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Avatar(name: member.name, size: 38),
            const SizedBox(width: Space.md),
            Expanded(
              child: Text(member.name, style: AppType.h3.copyWith(color: c.t1), overflow: TextOverflow.ellipsis),
            ),
            StatusBadge(member.active ? 'Ativo' : 'Inativo', tone: member.active ? BadgeTone.success : BadgeTone.neutral),
          ]),
          const SizedBox(height: Space.md),
          Text('Serviços', style: AppType.caption.copyWith(color: c.t3)),
          const SizedBox(height: 4),
          Text(
            names.isEmpty ? 'Nenhum serviço marcado: o bot não oferece horários com essa pessoa.' : names.join(' · '),
            style: AppType.small.copyWith(color: names.isEmpty ? c.amber : c.t2, height: 1.4),
          ),
          const SizedBox(height: Space.md),
          Text('Horário', style: AppType.caption.copyWith(color: c.t3)),
          const SizedBox(height: 4),
          for (final line in _summary(member.hours)) Text(line, style: AppType.small.copyWith(color: c.t2, height: 1.5)),
          const SizedBox(height: Space.md),
          AppButton(label: 'Editar', size: ButtonSize.small, variant: ButtonVariant.secondary, icon: Icons.edit_outlined, onPressed: onEdit),
        ],
      ),
    );
  }
}

/// "Seg a Sex: 09:00–12:00, 13:00–19:00" agrupando dias iguais seguidos.
List<String> _summary(List<WorkRange> hours) {
  if (hours.isEmpty) return const ['Sem horário cadastrado'];
  String dayText(int d) {
    final ranges = hours.where((h) => h.day == d).toList()..sort((a, b) => a.start.compareTo(b.start));
    return ranges.map((r) => '${formatMinutesAsClock(r.start)}–${formatMinutesAsClock(r.end)}').join(', ');
  }

  final order = [1, 2, 3, 4, 5, 6, 0];
  final lines = <String>[];
  var i = 0;
  while (i < order.length) {
    final text = dayText(order[i]);
    var j = i;
    while (j + 1 < order.length && dayText(order[j + 1]) == text) {
      j++;
    }
    if (text.isNotEmpty) {
      final label = i == j ? _days[order[i]] : '${_days[order[i]]} a ${_days[order[j]]}';
      lines.add('$label: $text');
    }
    i = j + 1;
  }
  return lines;
}

// ------------------------------------------------------------------ edição
class _DayPlan {
  bool on;
  int start;
  int end;
  bool pause = false;
  int pauseStart = 12 * 60;
  int pauseEnd = 13 * 60;
  _DayPlan({this.on = false, this.start = 9 * 60, this.end = 18 * 60});

  factory _DayPlan.from(List<WorkRange> ranges) {
    if (ranges.isEmpty) return _DayPlan();
    ranges.sort((a, b) => a.start.compareTo(b.start));
    final p = _DayPlan(on: true, start: ranges.first.start, end: ranges.last.end);
    if (ranges.length >= 2) {
      p.pause = true;
      p.pauseStart = ranges.first.end;
      p.pauseEnd = ranges[1].start;
    }
    return p;
  }

  String? get problem {
    if (!on) return null;
    if (end <= start) return 'O fim precisa ser depois do início.';
    if (pause && !(start < pauseStart && pauseStart < pauseEnd && pauseEnd < end)) return 'A pausa precisa ficar dentro do horário.';
    return null;
  }

  List<WorkRange> ranges(int day) {
    if (!on) return const [];
    if (pause) return [WorkRange(day, start, pauseStart), WorkRange(day, pauseEnd, end)];
    return [WorkRange(day, start, end)];
  }
}

class _MemberEditor extends StatefulWidget {
  final TeamMember? member;
  final List<ServiceItem> services;
  final List<WorkRange> suggestedHours;
  const _MemberEditor({required this.member, required this.services, required this.suggestedHours});

  @override
  State<_MemberEditor> createState() => _MemberEditorState();
}

class _MemberEditorState extends State<_MemberEditor> {
  late final _name = TextEditingController(text: widget.member?.name ?? '');
  late bool _active = widget.member?.active ?? true;
  late final Set<String> _serviceIds = {
    ...(widget.member?.serviceIds ?? [for (final s in widget.services) if (s.active) s.id]),
  };
  late final List<_DayPlan> _week = [
    for (var d = 0; d < 7; d++)
      _DayPlan.from([
        for (final h in (widget.member?.hours ?? _defaultHours())) if (h.day == d) h,
      ]),
  ];
  bool _saving = false;
  String? _error;

  List<WorkRange> _defaultHours() => widget.suggestedHours.isNotEmpty
      ? widget.suggestedHours
      : [for (var d = 1; d <= 6; d++) WorkRange(d, 9 * 60, 18 * 60)];

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    final problems = [for (var d = 0; d < 7; d++) if (_week[d].problem != null) '${_daysFull[d]}: ${_week[d].problem}'];
    if (name.isEmpty) return setState(() => _error = 'Informe o nome.');
    if (problems.isNotEmpty) return setState(() => _error = problems.first);
    final hours = [for (var d = 0; d < 7; d++) ..._week[d].ranges(d)];
    setState(() {
      _saving = true;
      _error = null;
    });
    final team = AppScope.read(context).team;
    try {
      if (widget.member == null) {
        await team.create(name: name, serviceIds: _serviceIds.toList(), hours: hours);
      } else {
        await team.update(widget.member!, name: name, active: _active, serviceIds: _serviceIds.toList(), hours: hours);
      }
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final narrow = MediaQuery.sizeOf(context).width < 560;
    return Dialog(
      backgroundColor: c.card,
      insetPadding: EdgeInsets.symmetric(horizontal: narrow ? Space.md : Space.xxl, vertical: Space.xl),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.xl)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 640),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(Space.xl, Space.xl, Space.xl, Space.md),
              child: Text(widget.member == null ? 'Novo profissional' : 'Editar ${widget.member!.name}', style: AppType.h2.copyWith(color: c.t1)),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: Space.xl),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    AppTextField(label: 'Nome', controller: _name, hint: 'Como aparece para o cliente', autofocus: widget.member == null),
                    if (widget.member != null) ...[
                      const SizedBox(height: Space.md),
                      SettingRow(
                        title: 'Ativo',
                        description: 'Desativado, o bot para de oferecer horários com essa pessoa. Os horários já marcados continuam na agenda.',
                        value: _active,
                        onChanged: (v) => setState(() => _active = v),
                      ),
                    ],
                    const AppDivider(vertical: Space.lg),
                    Text('Serviços que faz', style: AppType.h3.copyWith(color: c.t1)),
                    const SizedBox(height: Space.sm),
                    if (widget.services.isEmpty)
                      Text('Cadastre os serviços na aba Serviços primeiro.', style: AppType.small.copyWith(color: c.t2))
                    else
                      Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
                        for (final s in widget.services)
                          FilterChip(
                            label: Text(s.name),
                            selected: _serviceIds.contains(s.id),
                            showCheckmark: false,
                            labelStyle: AppType.small.copyWith(color: _serviceIds.contains(s.id) ? c.onPrimary : c.t1),
                            selectedColor: c.primary,
                            backgroundColor: c.surf,
                            side: BorderSide(color: _serviceIds.contains(s.id) ? c.primary : c.border),
                            onSelected: (v) => setState(() => v ? _serviceIds.add(s.id) : _serviceIds.remove(s.id)),
                          ),
                      ]),
                    const AppDivider(vertical: Space.lg),
                    Text('Horário da semana', style: AppType.h3.copyWith(color: c.t1)),
                    const SizedBox(height: 3),
                    Text('Use a pausa para almoço ou intervalo fixo. Para um compromisso num dia só, bloqueie pela Agenda ou pelo WhatsApp.',
                        style: AppType.small.copyWith(color: c.t2, height: 1.45)),
                    const SizedBox(height: Space.md),
                    for (final d in const [1, 2, 3, 4, 5, 6, 0]) _DayRow(day: d, plan: _week[d], onChanged: () => setState(() {})),
                    if (_error != null) ...[
                      const SizedBox(height: Space.md),
                      InfoBanner(tone: BannerTone.danger, message: _error!),
                    ],
                    const SizedBox(height: Space.lg),
                  ],
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(Space.xl, Space.md, Space.xl, Space.lg),
              decoration: BoxDecoration(border: Border(top: BorderSide(color: c.border))),
              child: Wrap(
                alignment: WrapAlignment.spaceBetween,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: Space.sm,
                runSpacing: Space.sm,
                children: [
                  const SizedBox.shrink(),
                  Wrap(spacing: Space.sm, children: [
                    AppButton(label: 'Cancelar', variant: ButtonVariant.secondary, onPressed: _saving ? null : () => Navigator.of(context).pop(false)),
                    AppButton(label: 'Salvar', icon: Icons.check_rounded, loading: _saving, onPressed: _save),
                  ]),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DayRow extends StatelessWidget {
  final int day;
  final _DayPlan plan;
  final VoidCallback onChanged;
  final bool business;
  const _DayRow({required this.day, required this.plan, required this.onChanged, this.business = false});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    Widget time(String label, int value, ValueChanged<int> set) => SizedBox(
          width: 132,
          child: TimePickerField(label: label, minutes: value, stepMinutes: 15, onChanged: (v) {
            set(v);
            onChanged();
          }),
        );
    return Container(
      margin: const EdgeInsets.only(bottom: Space.sm),
      padding: const EdgeInsets.all(Space.md),
      decoration: BoxDecoration(
        color: plan.on ? c.surf : Colors.transparent,
        borderRadius: BorderRadius.circular(Radii.md),
        border: Border.all(color: plan.problem != null ? c.amber : c.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(child: Text(_daysFull[day], style: AppType.bodyStrong.copyWith(color: plan.on ? c.t1 : c.t3))),
            Text(plan.on ? (business ? 'Aberto' : 'Trabalha') : (business ? 'Fechado' : 'Folga'), style: AppType.caption.copyWith(color: c.t2)),
            const SizedBox(width: Space.sm),
            AppSwitch(value: plan.on, onChanged: (v) {
              plan.on = v;
              onChanged();
            }),
          ]),
          AnimatedSize(
            duration: context.reactDuration,
            alignment: Alignment.topCenter,
            child: !plan.on
                ? const SizedBox(width: double.infinity)
                : Padding(
                    padding: const EdgeInsets.only(top: Space.sm),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Wrap(spacing: Space.md, runSpacing: Space.sm, children: [
                          time('Começa', plan.start, (v) => plan.start = v),
                          time('Termina', plan.end, (v) => plan.end = v),
                        ]),
                        const SizedBox(height: Space.sm),
                        Row(children: [
                          Expanded(child: Text('Pausa no meio do dia', style: AppType.small.copyWith(color: c.t2))),
                          AppSwitch(value: plan.pause, onChanged: (v) {
                            plan.pause = v;
                            onChanged();
                          }),
                        ]),
                        if (plan.pause) ...[
                          const SizedBox(height: Space.sm),
                          Wrap(spacing: Space.md, runSpacing: Space.sm, children: [
                            time('Pausa de', plan.pauseStart, (v) => plan.pauseStart = v),
                            time('Até', plan.pauseEnd, (v) => plan.pauseEnd = v),
                          ]),
                        ],
                        if (plan.problem != null) ...[
                          const SizedBox(height: Space.sm),
                          Text(plan.problem!, style: AppType.caption.copyWith(color: c.amber)),
                        ],
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _BusinessHoursEditor extends StatefulWidget {
  final List<WorkRange> hours;
  const _BusinessHoursEditor({required this.hours});

  @override
  State<_BusinessHoursEditor> createState() => _BusinessHoursEditorState();
}

class _BusinessHoursEditorState extends State<_BusinessHoursEditor> {
  late final List<_DayPlan> _week = [
    for (var d = 0; d < 7; d++)
      _DayPlan.from([
        for (final h in (widget.hours.isEmpty ? [for (var x = 1; x <= 6; x++) WorkRange(x, 9 * 60, 18 * 60)] : widget.hours))
          if (h.day == d) h,
      ]),
  ];
  bool _saving = false;
  String? _error;

  Future<void> _save() async {
    final problems = [for (var d = 0; d < 7; d++) if (_week[d].problem != null) '${_daysFull[d]}: ${_week[d].problem}'];
    if (problems.isNotEmpty) return setState(() => _error = problems.first);
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await AppScope.read(context).team.saveBusinessHours([for (var d = 0; d < 7; d++) ..._week[d].ranges(d)]);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final narrow = MediaQuery.sizeOf(context).width < 560;
    return Dialog(
      backgroundColor: c.card,
      insetPadding: EdgeInsets.symmetric(horizontal: narrow ? Space.md : Space.xxl, vertical: Space.xl),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.xl)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 640),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(Space.xl, Space.xl, Space.xl, Space.sm),
              child: Text('Horário de funcionamento', style: AppType.h2.copyWith(color: c.t1)),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(Space.xl, 0, Space.xl, Space.md),
              child: Text(
                'Vale para todas as semanas. Para fechar um dia específico (feriado, folga), use a tela Encerrar ou peça ao bot pelo WhatsApp.',
                style: AppType.small.copyWith(color: c.t2, height: 1.45),
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: Space.xl),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final d in const [1, 2, 3, 4, 5, 6, 0]) _DayRow(day: d, plan: _week[d], business: true, onChanged: () => setState(() {})),
                    if (_error != null) ...[
                      const SizedBox(height: Space.md),
                      InfoBanner(tone: BannerTone.danger, message: _error!),
                    ],
                    const SizedBox(height: Space.lg),
                  ],
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(Space.xl, Space.md, Space.xl, Space.lg),
              decoration: BoxDecoration(border: Border(top: BorderSide(color: c.border))),
              child: Wrap(
                alignment: WrapAlignment.end,
                spacing: Space.sm,
                runSpacing: Space.sm,
                children: [
                  AppButton(label: 'Cancelar', variant: ButtonVariant.secondary, onPressed: _saving ? null : () => Navigator.of(context).pop(false)),
                  AppButton(label: 'Salvar horário', icon: Icons.check_rounded, loading: _saving, onPressed: _save),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
