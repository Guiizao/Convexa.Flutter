import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/date_utils.dart';
import '../../core/formatters.dart';
import '../../core/responsive.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';
import '../components/buttons.dart';
import '../components/charts.dart';
import '../components/inputs.dart';
import '../components/primitives.dart';

class ExpedienteScreen extends StatefulWidget {
  const ExpedienteScreen({super.key});

  @override
  State<ExpedienteScreen> createState() => _ExpedienteScreenState();
}

class _ExpedienteScreenState extends State<ExpedienteScreen> {
  Timer? _clock;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _clock = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _clock?.cancel();
    super.dispose();
  }

  Future<void> _openShift() async {
    setState(() => _busy = true);
    final error = await AppScope.read(context).openShift();
    if (!mounted) return;
    setState(() => _busy = false);
    if (error != null) _toast(error, isError: true);
  }

  Future<void> _closeShift() async {
    setState(() => _busy = true);
    final error = await AppScope.read(context).closeShift();
    if (!mounted) return;
    setState(() => _busy = false);
    if (error != null) {
      _toast(error, isError: true);
    } else {
      _toast('Expediente encerrado. Programe o dia seguinte na aba Encerrar.');
    }
  }

  Future<void> _reopen() async {
    setState(() => _busy = true);
    final error = await AppScope.read(context).reopenShift();
    if (!mounted) return;
    setState(() => _busy = false);
    if (error != null) _toast(error, isError: true);
  }

  void _toast(String message, {bool isError = false}) {
    final c = context.colors;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message, style: AppType.small.copyWith(color: c.t1)),
        backgroundColor: isError ? c.redWash : c.surf,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.md),
          side: BorderSide(color: isError ? c.red : c.border),
        ),
      ),
    );
  }

  void _addBreak() {
    showDialog<void>(
      context: context,
      builder: (_) => const _BreakDialog(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final wide = Responsive.isDesktop(context);

    final left = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _ShiftHeroCard(
          busy: _busy,
          onOpen: _openShift,
          onClose: _closeShift,
          onReopen: _reopen,
        ),
        const SizedBox(height: Space.lg),
        _HoursCard(onAddBreak: _addBreak),
      ],
    );

    final right = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: const [
        _DayGlanceCard(),
        SizedBox(height: Space.lg),
        _ServicesOfDayCard(),
      ],
    );

    if (!wide) {
      return Column(children: [left, const SizedBox(height: Space.lg), right]);
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(flex: 7, child: left),
        const SizedBox(width: Space.lg),
        Expanded(flex: 5, child: right),
      ],
    );
  }
}

class _ShiftHeroCard extends StatelessWidget {
  final bool busy;
  final VoidCallback onOpen;
  final VoidCallback onClose;
  final VoidCallback onReopen;

  const _ShiftHeroCard({
    required this.busy,
    required this.onOpen,
    required this.onClose,
    required this.onReopen,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final shift = state.shift;
    final now = DateTime.now();
    final session = state.session;

    final greeting = greetingForHour(now.hour);
    final firstName = session?.userName.split(' ').first ?? '';

    return AppCard(
      padding: const EdgeInsets.all(Space.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      firstName.isEmpty ? greeting : '$greeting, $firstName',
                      style: AppType.display.copyWith(color: c.t1),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      fullDateLabel(state.selectedDate),
                      style: AppType.small.copyWith(color: c.t2),
                    ),
                  ],
                ),
              ),
              _StatePip(state: shift.state),
            ],
          ),
          const SizedBox(height: Space.xl),
          _ShiftProgress(shift: shift, now: now),
          const SizedBox(height: Space.xl),
          if (shift.state == ShiftState.closed) ...[
            if (state.openBlockReason != null) ...[
              InfoBanner(
                message: state.openBlockReason!,
                tone: BannerTone.warning,
              ),
              const SizedBox(height: Space.lg),
            ],
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: 'Abrir expediente',
                    icon: Icons.play_arrow_rounded,
                    size: ButtonSize.large,
                    expand: true,
                    loading: busy,
                    onPressed: state.canOpenShift ? onOpen : null,
                  ),
                ),
              ],
            ),
            const SizedBox(height: Space.md),
            Text(
              state.settings.openingBroadcast
                  ? 'Ao abrir, o agente avisa no WhatsApp todos os clientes com horário marcado hoje.'
                  : 'O aviso automático de abertura está desligado nas configurações.',
              style: AppType.caption.copyWith(color: c.t2, height: 1.5),
            ),
          ] else if (shift.state == ShiftState.open) ...[
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: 'Encerrar expediente',
                    icon: Icons.stop_rounded,
                    variant: ButtonVariant.danger,
                    size: ButtonSize.large,
                    expand: true,
                    loading: busy,
                    onPressed: onClose,
                  ),
                ),
              ],
            ),
            const SizedBox(height: Space.md),
            Text(
              'Ao encerrar, o agente para de oferecer horários de hoje e você confirma os atendimentos realizados.',
              style: AppType.caption.copyWith(color: c.t2, height: 1.5),
            ),
          ] else ...[
            InfoBanner(
              message:
                  'Dia encerrado${shift.closedAt != null ? ' às ${formatTimeOfDay(shift.closedAt!)}' : ''}. Reabra apenas se ainda for atender alguém hoje.',
              tone: BannerTone.success,
            ),
            const SizedBox(height: Space.lg),
            AppButton(
              label: 'Reabrir expediente',
              icon: Icons.refresh_rounded,
              variant: ButtonVariant.secondary,
              size: ButtonSize.large,
              expand: true,
              loading: busy,
              onPressed: onReopen,
            ),
          ],
        ],
      ),
    );
  }
}

class _StatePip extends StatelessWidget {
  final ShiftState state;
  const _StatePip({required this.state});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final (color, label) = switch (state) {
      ShiftState.open => (c.success, 'Aberto'),
      ShiftState.closed => (c.amber, 'Fechado'),
      ShiftState.finished => (c.t2, 'Encerrado'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Space.md, vertical: 7),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(Radii.pill),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 7),
          Text(label,
              style: AppType.caption.copyWith(
                  color: color, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

class _ShiftProgress extends StatelessWidget {
  final WorkShift shift;
  final DateTime now;

  const _ShiftProgress({required this.shift, required this.now});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final nowMinutes = now.hour * 60 + now.minute;

    final blocks = <({int start, int end, Color color, String label})>[
      ...state.bookedAppointments.map((a) {
        final start = a.startAt.hour * 60 + a.startAt.minute;
        return (
          start: start,
          end: start + a.durationMinutes,
          color: switch (a.status) {
            AppointmentStatus.completed => c.success,
            AppointmentStatus.confirmed => c.primary,
            AppointmentStatus.noShow => c.red,
            _ => c.info,
          },
          label: '${formatTimeOfDay(a.startAt)} · ${a.customerName}',
        );
      }),
      ...shift.breaks.map((b) => (
            start: b.range.startMinutes,
            end: b.range.endMinutes,
            color: c.t3,
            label: b.label,
          )),
    ];

    final elapsed = shift.state == ShiftState.open
        ? ((nowMinutes - shift.hours.startMinutes) /
                shift.hours.durationMinutes)
            .clamp(0.0, 1.0)
        : (shift.state == ShiftState.finished ? 1.0 : 0.0);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Overline('Linha do dia'),
            const Spacer(),
            Text(
              '${formatMinutesAsClock(shift.hours.startMinutes)} às ${formatMinutesAsClock(shift.hours.endMinutes)}',
              style: AppType.caption.copyWith(color: c.t2),
            ),
          ],
        ),
        const SizedBox(height: Space.md),
        DayTimeline(
          startMinutes: shift.hours.startMinutes,
          endMinutes: shift.hours.endMinutes,
          nowMinutes: nowMinutes,
          blocks: blocks,
        ),
        const SizedBox(height: Space.md),
        ProgressBar(value: elapsed),
        const SizedBox(height: Space.lg),
        Wrap(
          spacing: Space.md,
          runSpacing: 6,
          children: [
            _LegendChip(color: c.info, label: 'Aguardando'),
            _LegendChip(color: c.primary, label: 'Confirmado'),
            _LegendChip(color: c.success, label: 'Atendido'),
            if (state.bookedAppointments
                .any((a) => a.status == AppointmentStatus.noShow))
              _LegendChip(color: c.red, label: 'Faltou'),
            if (shift.breaks.isNotEmpty)
              _LegendChip(color: c.t3, label: 'Pausa'),
            _LegendChip(color: c.red, label: 'Agora', isLine: true),
          ],
        ),
      ],
    );
  }
}

class _HoursCard extends StatelessWidget {
  final VoidCallback onAddBreak;
  const _HoursCard({required this.onAddBreak});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final shift = state.shift;
    final locked = shift.state == ShiftState.finished;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(
            title: 'Janela de atendimento',
            subtitle:
                'Define quais horários o agente pode oferecer no WhatsApp.',
          ),
          // Três campos lado a lado não cabem em 375px: o valor era cortado no
          // meio. Abaixo de 560px o intervalo desce para a própria linha.
          LayoutBuilder(
            builder: (context, constraints) {
              final abertura = TimePickerField(
                label: 'Abertura',
                minutes: shift.hours.startMinutes,
                stepMinutes: 15,
                maxMinutes: shift.hours.endMinutes - 15,
                onChanged: locked
                    ? (_) {}
                    : (v) => state.updateShiftHours(
                        shift.hours.copyWith(startMinutes: v)),
              );
              final encerramento = TimePickerField(
                label: 'Encerramento',
                minutes: shift.hours.endMinutes,
                stepMinutes: 15,
                minMinutes: shift.hours.startMinutes + 15,
                onChanged: locked
                    ? (_) {}
                    : (v) => state.updateShiftHours(
                        shift.hours.copyWith(endMinutes: v)),
              );
              final intervalo = NumberStepper(
                label: 'Intervalo entre horários',
                value: shift.slotMinutes,
                suffix: ' min',
                step: 5,
                min: 10,
                max: 120,
                onChanged: locked ? (_) {} : state.updateSlotMinutes,
              );

              if (constraints.maxWidth >= 560) {
                return Row(
                  children: [
                    Expanded(child: abertura),
                    const SizedBox(width: Space.md),
                    Expanded(child: encerramento),
                    const SizedBox(width: Space.md),
                    Expanded(child: intervalo),
                  ],
                );
              }

              return Column(
                children: [
                  Row(
                    children: [
                      Expanded(child: abertura),
                      const SizedBox(width: Space.md),
                      Expanded(child: encerramento),
                    ],
                  ),
                  const SizedBox(height: Space.md),
                  intervalo,
                ],
              );
            },
          ),
          const AppDivider(),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Pausas do dia',
                        style: AppType.h3.copyWith(color: c.t1)),
                    const SizedBox(height: 2),
                    Text(
                      'Almoço, café ou qualquer bloqueio. O agente não oferece esses horários.',
                      style: AppType.caption.copyWith(color: c.t2),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: Space.md),
              AppButton(
                label: 'Adicionar',
                icon: Icons.add_rounded,
                variant: ButtonVariant.secondary,
                size: ButtonSize.small,
                onPressed: locked ? null : onAddBreak,
              ),
            ],
          ),
          const SizedBox(height: Space.md),
          if (shift.breaks.isEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: Space.lg),
              decoration: BoxDecoration(
                color: c.surf,
                borderRadius: BorderRadius.circular(Radii.md),
                border: Border.all(color: c.border),
              ),
              child: Text(
                'Nenhuma pausa programada para hoje.',
                textAlign: TextAlign.center,
                style: AppType.small.copyWith(color: c.t2),
              ),
            )
          else
            Wrap(
              spacing: Space.sm,
              runSpacing: Space.sm,
              children: shift.breaks
                  .map((b) => Container(
                        padding: const EdgeInsets.fromLTRB(
                            Space.md, 7, 6, 7),
                        decoration: BoxDecoration(
                          color: c.surf,
                          borderRadius: BorderRadius.circular(Radii.md),
                          border: Border.all(color: c.border),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.pause_rounded, size: 13, color: c.t2),
                            const SizedBox(width: 6),
                            Text(
                              '${b.label} · ${formatMinutesAsClock(b.range.startMinutes)}–${formatMinutesAsClock(b.range.endMinutes)}',
                              style: AppType.caption.copyWith(color: c.t1),
                            ),
                            const SizedBox(width: 4),
                            if (!locked)
                              InkWell(
                                onTap: () => state.removeBreak(b.id),
                                borderRadius: BorderRadius.circular(4),
                                child: Padding(
                                  padding: const EdgeInsets.all(3),
                                  child: Icon(Icons.close_rounded,
                                      size: 13, color: c.t2),
                                ),
                              ),
                          ],
                        ),
                      ))
                  .toList(),
            ),
        ],
      ),
    );
  }
}

class _DayGlanceCard extends StatelessWidget {
  const _DayGlanceCard();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final appointments = state.bookedAppointments;
    final shift = state.shift;

    final totalSlots = shift.hours.isValid
        ? (shift.hours.durationMinutes / shift.slotMinutes).floor()
        : 0;
    final booked = appointments.length;
    final free = (totalSlots - booked).clamp(0, totalSlots);
    final occupancy = totalSlots == 0 ? 0.0 : booked / totalSlots;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            title: 'Panorama de hoje',
            subtitle: 'Atualizado conforme o agente confirma agendamentos.',
          ),
          Row(
            children: [
              Expanded(
                child: _GlanceStat(
                  label: 'Agendados',
                  value: '$booked',
                  icon: Icons.event_available_outlined,
                ),
              ),
              Container(width: 1, height: 44, color: c.border),
              Expanded(
                child: _GlanceStat(
                  label: 'Livres',
                  value: '$free',
                  icon: Icons.event_outlined,
                ),
              ),
              Container(width: 1, height: 44, color: c.border),
              Expanded(
                child: _GlanceStat(
                  label: 'Previsto',
                  value: formatCurrencyCompact(state.expectedRevenueCents),
                  icon: Icons.payments_outlined,
                ),
              ),
            ],
          ),
          const SizedBox(height: Space.xl),
          Row(
            children: [
              Text('Ocupação', style: AppType.caption.copyWith(color: c.t2)),
              const Spacer(),
              Text(
                '${(occupancy * 100).round()}%',
                style: AppType.caption.copyWith(
                    color: c.t1, fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: 7),
          ProgressBar(
            value: occupancy,
            color: occupancy > 0.85 ? c.amber : c.primary,
          ),
          if (booked == 0) ...[
            const SizedBox(height: Space.lg),
            Text(
              shift.state == ShiftState.open
                  ? 'Nenhum horário marcado ainda. O agente já está oferecendo os horários de hoje.'
                  : 'Abra o expediente para o agente começar a oferecer os horários de hoje.',
              style: AppType.caption.copyWith(color: c.t2, height: 1.5),
            ),
          ],
        ],
      ),
    );
  }
}

class _GlanceStat extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;

  const _GlanceStat({
    required this.label,
    required this.value,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Column(
      children: [
        Icon(icon, size: 15, color: c.t2),
        const SizedBox(height: 7),
        Text(value, style: AppType.h1.copyWith(color: c.t1)),
        const SizedBox(height: 2),
        Text(label, style: AppType.caption.copyWith(color: c.t2)),
      ],
    );
  }
}

class _ServicesOfDayCard extends StatelessWidget {
  const _ServicesOfDayCard();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final services = state.serviceList;
    final locked = state.shift.state == ShiftState.finished;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            title: 'Serviços disponíveis hoje',
            subtitle: 'Desligue o que você não vai atender neste dia.',
          ),
          if (services.isEmpty)
            EmptyState(
              icon: Icons.content_cut_outlined,
              title: 'Nenhum serviço cadastrado',
              message:
                  'Cadastre os serviços do seu estabelecimento para o agente poder oferecê-los.',
              padding: const EdgeInsets.symmetric(vertical: Space.xl),
            )
          else
            ...services.map((service) {
              final enabled =
                  state.shift.activeServiceIds.contains(service.id);
              return Padding(
                padding: const EdgeInsets.only(bottom: Space.sm),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: Space.md, vertical: Space.md),
                  decoration: BoxDecoration(
                    color: enabled ? c.surf : Colors.transparent,
                    borderRadius: BorderRadius.circular(Radii.md),
                    border: Border.all(
                        color: enabled ? c.border : c.border.withValues(alpha: 0.5)),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              service.name,
                              style: AppType.bodyStrong.copyWith(
                                color: enabled ? c.t1 : c.t2,
                              ),
                            ),
                            const SizedBox(height: 1),
                            Text(
                              '${formatDuration(service.durationMinutes)} · ${formatCurrency(service.priceCents)}',
                              style: AppType.caption.copyWith(color: c.t2),
                            ),
                          ],
                        ),
                      ),
                      AppSwitch(
                        value: enabled,
                        onChanged: locked
                            ? null
                            : (_) => state.toggleShiftService(service.id),
                      ),
                    ],
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}

class _BreakDialog extends StatefulWidget {
  const _BreakDialog();

  @override
  State<_BreakDialog> createState() => _BreakDialogState();
}

class _BreakDialogState extends State<_BreakDialog> {
  int _start = 12 * 60;
  int _end = 13 * 60;
  final _label = TextEditingController(text: 'Almoço');

  @override
  void dispose() {
    _label.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final problem = AppScope.of(context).validateBreak(TimeRange(_start, _end));

    return Dialog(
      backgroundColor: Colors.transparent,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: AppCard(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SectionHeader(
                title: 'Nova pausa',
                subtitle: 'O agente deixa de oferecer horários nesse intervalo.',
              ),
              AppTextField(
                label: 'Descrição',
                controller: _label,
                hint: 'Almoço, café, compromisso...',
              ),
              const SizedBox(height: Space.lg),
              Row(
                children: [
                  Expanded(
                    child: TimePickerField(
                      label: 'Início',
                      minutes: _start,
                      stepMinutes: 15,
                      onChanged: (v) => setState(() => _start = v),
                    ),
                  ),
                  const SizedBox(width: Space.md),
                  Expanded(
                    child: TimePickerField(
                      label: 'Fim',
                      minutes: _end,
                      stepMinutes: 15,
                      onChanged: (v) => setState(() => _end = v),
                    ),
                  ),
                ],
              ),
              if (problem != null) ...[
                const SizedBox(height: Space.lg),
                InfoBanner(message: problem, tone: BannerTone.warning),
              ],
              const SizedBox(height: Space.xl),
              Row(
                children: [
                  Expanded(
                    child: AppButton(
                      label: 'Cancelar',
                      variant: ButtonVariant.secondary,
                      expand: true,
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ),
                  const SizedBox(width: Space.md),
                  Expanded(
                    child: AppButton(
                      label: 'Adicionar pausa',
                      expand: true,
                      onPressed: problem != null
                          ? null
                          : () {
                              AppScope.read(context).addBreak(
                                TimeRange(_start, _end),
                                _label.text.trim().isEmpty
                                    ? 'Intervalo'
                                    : _label.text.trim(),
                              );
                              Navigator.of(context).pop();
                            },
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LegendChip extends StatelessWidget {
  final Color color;
  final String label;
  final bool isLine;

  const _LegendChip({
    required this.color,
    required this.label,
    this.isLine = false,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: isLine ? 2 : 10,
          height: 10,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(isLine ? 1 : 3),
          ),
        ),
        const SizedBox(width: 6),
        Text(label, style: AppType.caption.copyWith(color: c.t2)),
      ],
    );
  }
}
