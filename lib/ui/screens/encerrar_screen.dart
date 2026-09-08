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

class EncerrarScreen extends StatefulWidget {
  const EncerrarScreen({super.key});

  @override
  State<EncerrarScreen> createState() => _EncerrarScreenState();
}

class _EncerrarScreenState extends State<EncerrarScreen> {
  late TimeRange _tomorrowHours;
  late int _tomorrowSlot;
  bool _tomorrowOff = false;
  bool _sendSummary = true;
  bool _busy = false;
  bool _initialized = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_initialized) return;
    final shift = AppScope.of(context).shift;
    _tomorrowHours = shift.hours;
    _tomorrowSlot = shift.slotMinutes;
    _initialized = true;
  }

  Future<void> _finish() async {
    final state = AppScope.read(context);
    final tomorrowDate = state.selectedDate.add(const Duration(days: 1));

    setState(() => _busy = true);
    final error = await state.closeShift(
      tomorrow: WorkShift(
        date: tomorrowDate,
        state: _tomorrowOff ? ShiftState.closed : ShiftState.open,
        hours: _tomorrowHours,
        slotMinutes: _tomorrowSlot,
        activeServiceIds: state.shift.activeServiceIds,
      ),
    );
    if (!mounted) return;
    setState(() => _busy = false);

    final c = context.colors;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          error ??
              (_tomorrowOff
                  ? 'Dia encerrado. Amanhã ficará marcado como folga.'
                  : 'Dia encerrado. Amanhã abre ${formatMinutesAsClock(_tomorrowHours.startMinutes)}.'),
          style: AppType.small.copyWith(color: c.t1),
        ),
        backgroundColor: error != null ? c.redWash : c.surf,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.md),
          side: BorderSide(color: error != null ? c.red : c.border),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final wide = Responsive.isDesktop(context);

    final left = Column(
      children: const [
        _DaySummaryCard(),
        SizedBox(height: Space.lg),
        _PendingConfirmationCard(),
      ],
    );

    final right = Column(
      children: [
        _TomorrowCard(
          hours: _tomorrowHours,
          slot: _tomorrowSlot,
          dayOff: _tomorrowOff,
          onHours: (v) => setState(() => _tomorrowHours = v),
          onSlot: (v) => setState(() => _tomorrowSlot = v),
          onDayOff: (v) => setState(() => _tomorrowOff = v),
        ),
        const SizedBox(height: Space.lg),
        _CloseCard(
          busy: _busy,
          sendSummary: _sendSummary,
          onSendSummary: (v) => setState(() => _sendSummary = v),
          onFinish: state.shift.state == ShiftState.finished ? null : _finish,
        ),
      ],
    );

    if (!wide) {
      return Column(children: [left, const SizedBox(height: Space.lg), right]);
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(flex: 6, child: left),
        const SizedBox(width: Space.lg),
        Expanded(flex: 5, child: right),
      ],
    );
  }
}

class _DaySummaryCard extends StatelessWidget {
  const _DaySummaryCard();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final appointments = state.bookedAppointments;

    final done = appointments
        .where((a) => a.status == AppointmentStatus.completed)
        .length;
    final noShow =
        appointments.where((a) => a.status == AppointmentStatus.noShow).length;
    final realized = state.confirmedRevenueCents;
    final expected = state.expectedRevenueCents;
    final achievement = expected == 0 ? 0.0 : realized / expected;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(
            title: 'Resumo de ${relativeDayLabel(state.selectedDate, DateTime.now()).toLowerCase()}',
            subtitle: fullDateLabel(state.selectedDate),
          ),
          ResponsiveGrid(
            minItemWidth: 150,
            spacing: Space.md,
            runSpacing: Space.md,
            children: [
              _SummaryTile(
                label: 'Atendidos',
                value: '$done',
                icon: Icons.check_circle_outline_rounded,
                color: c.success,
              ),
              _SummaryTile(
                label: 'Faltaram',
                value: '$noShow',
                icon: Icons.person_off_outlined,
                color: noShow > 0 ? c.red : c.t2,
              ),
              _SummaryTile(
                label: 'Recebido',
                value: formatCurrencyCompact(realized),
                icon: Icons.payments_outlined,
                color: c.primary,
              ),
            ],
          ),
          const SizedBox(height: Space.xl),
          Row(
            children: [
              Text('Do previsto para o dia',
                  style: AppType.caption.copyWith(color: c.t2)),
              const Spacer(),
              Text(
                '${formatCurrency(realized)} de ${formatCurrency(expected)}',
                style: AppType.caption.copyWith(
                    color: c.t1, fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: 7),
          ProgressBar(value: achievement),
        ],
      ),
    );
  }
}

class _SummaryTile extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color color;

  const _SummaryTile({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.all(Space.lg),
      decoration: BoxDecoration(
        color: c.surf,
        borderRadius: BorderRadius.circular(Radii.md),
        border: Border.all(color: c.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: color),
          const SizedBox(height: Space.md),
          Text(value, style: AppType.h1.copyWith(color: c.t1)),
          const SizedBox(height: 1),
          Text(label, style: AppType.caption.copyWith(color: c.t2)),
        ],
      ),
    );
  }
}

class _PendingConfirmationCard extends StatelessWidget {
  const _PendingConfirmationCard();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final pending = state.bookedAppointments
        .where((a) =>
            a.status == AppointmentStatus.scheduled ||
            a.status == AppointmentStatus.confirmed)
        .toList();

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            title: 'Confirmar atendimentos',
            subtitle:
                'Marque quem realmente foi atendido. É isso que alimenta a receita e o controle de faltas.',
          ),
          if (pending.isEmpty)
            InfoBanner(
              tone: BannerTone.success,
              message:
                  'Todos os horários do dia já estão com o status definido.',
            )
          else
            ...pending.map((a) => Padding(
                  padding: const EdgeInsets.only(bottom: Space.sm),
                  child: Container(
                    padding: const EdgeInsets.all(Space.md),
                    decoration: BoxDecoration(
                      color: c.surf,
                      borderRadius: BorderRadius.circular(Radii.md),
                      border: Border.all(color: c.border),
                    ),
                    child: Row(
                      children: [
                        Text(
                          formatTimeOfDay(a.startAt),
                          style: AppType.numericSm.copyWith(color: c.t1),
                        ),
                        const SizedBox(width: Space.md),
                        Avatar(name: a.customerName, size: 30),
                        const SizedBox(width: Space.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                a.customerName,
                                overflow: TextOverflow.ellipsis,
                                style:
                                    AppType.bodyStrong.copyWith(color: c.t1),
                              ),
                              Text(
                                '${a.serviceName} · ${formatCurrency(a.priceCents)}',
                                overflow: TextOverflow.ellipsis,
                                style: AppType.caption.copyWith(color: c.t2),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: Space.md),
                        AppIconButton(
                          icon: Icons.check_rounded,
                          size: 34,
                          tooltip: 'Foi atendido',
                          color: c.success,
                          onPressed: () => state.setAppointmentStatus(
                              a.id, AppointmentStatus.completed),
                        ),
                        const SizedBox(width: 6),
                        AppIconButton(
                          icon: Icons.close_rounded,
                          size: 34,
                          tooltip: 'Não compareceu',
                          color: c.red,
                          onPressed: () => state.setAppointmentStatus(
                              a.id, AppointmentStatus.noShow),
                        ),
                      ],
                    ),
                  ),
                )),
        ],
      ),
    );
  }
}

class _TomorrowCard extends StatelessWidget {
  final TimeRange hours;
  final int slot;
  final bool dayOff;
  final ValueChanged<TimeRange> onHours;
  final ValueChanged<int> onSlot;
  final ValueChanged<bool> onDayOff;

  const _TomorrowCard({
    required this.hours,
    required this.slot,
    required this.dayOff,
    required this.onHours,
    required this.onSlot,
    required this.onDayOff,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final tomorrow = state.selectedDate.add(const Duration(days: 1));

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(
            title: 'Programar amanhã',
            subtitle: mediumDateLabel(tomorrow),
          ),
          Container(
            padding: const EdgeInsets.all(Space.md),
            decoration: BoxDecoration(
              color: c.surf,
              borderRadius: BorderRadius.circular(Radii.md),
              border: Border.all(color: c.border),
            ),
            child: SettingRow(
              title: 'Amanhã é folga',
              description:
                  'O agente responde que não há atendimento e oferece o próximo dia útil.',
              value: dayOff,
              onChanged: onDayOff,
            ),
          ),
          if (!dayOff) ...[
            const SizedBox(height: Space.lg),
            Row(
              children: [
                Expanded(
                  child: TimePickerField(
                    label: 'Abertura',
                    minutes: hours.startMinutes,
                    stepMinutes: 15,
                    maxMinutes: hours.endMinutes - 15,
                    onChanged: (v) => onHours(hours.copyWith(startMinutes: v)),
                  ),
                ),
                const SizedBox(width: Space.md),
                Expanded(
                  child: TimePickerField(
                    label: 'Encerramento',
                    minutes: hours.endMinutes,
                    stepMinutes: 15,
                    minMinutes: hours.startMinutes + 15,
                    onChanged: (v) => onHours(hours.copyWith(endMinutes: v)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: Space.md),
            NumberStepper(
              label: 'Intervalo entre horários',
              value: slot,
              suffix: ' min',
              step: 5,
              min: 10,
              max: 120,
              onChanged: onSlot,
            ),
            const SizedBox(height: Space.md),
            Text(
              'Assim que você encerrar, o agente já passa a oferecer estes horários para quem chamar hoje à noite.',
              style: AppType.caption.copyWith(color: c.t2, height: 1.5),
            ),
          ],
        ],
      ),
    );
  }
}

class _CloseCard extends StatelessWidget {
  final bool busy;
  final bool sendSummary;
  final ValueChanged<bool> onSendSummary;
  final VoidCallback? onFinish;

  const _CloseCard({
    required this.busy,
    required this.sendSummary,
    required this.onSendSummary,
    this.onFinish,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final finished = state.shift.state == ShiftState.finished;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(title: 'Fechar o dia'),
          Container(
            padding: const EdgeInsets.all(Space.md),
            decoration: BoxDecoration(
              color: c.surf,
              borderRadius: BorderRadius.circular(Radii.md),
              border: Border.all(color: c.border),
            ),
            child: SettingRow(
              title: 'Receber resumo no WhatsApp',
              description:
                  'O agente envia o fechamento do dia no seu número de dono.',
              value: sendSummary,
              onChanged: onSendSummary,
            ),
          ),
          const SizedBox(height: Space.lg),
          if (finished)
            InfoBanner(
              tone: BannerTone.success,
              message:
                  'Dia já encerrado. Para atender mais alguém hoje, reabra o expediente na aba Expediente.',
            )
          else
            AppButton(
              label: 'Encerrar expediente',
              icon: Icons.nightlight_round,
              size: ButtonSize.large,
              expand: true,
              loading: busy,
              onPressed: onFinish,
            ),
        ],
      ),
    );
  }
}
