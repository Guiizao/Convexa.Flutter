import 'package:flutter/material.dart';

import '../../core/date_utils.dart';
import '../../core/formatters.dart';
import '../../core/responsive.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';
import '../components/buttons.dart';
import '../components/motion.dart';
import '../components/primitives.dart';

enum AgendaFilter { todos, novos, confirmados, atendidos }

class AgendaScreen extends StatefulWidget {
  const AgendaScreen({super.key});

  @override
  State<AgendaScreen> createState() => _AgendaScreenState();
}

class _AgendaScreenState extends State<AgendaScreen> {
  AgendaFilter _filter = AgendaFilter.todos;

  List<Appointment> _apply(List<Appointment> source) => switch (_filter) {
        AgendaFilter.todos => source,
        AgendaFilter.novos => source
            .where((a) => a.status == AppointmentStatus.scheduled)
            .toList(),
        AgendaFilter.confirmados => source
            .where((a) => a.status == AppointmentStatus.confirmed)
            .toList(),
        AgendaFilter.atendidos => source
            .where((a) => a.status == AppointmentStatus.completed)
            .toList(),
      };

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final wide = Responsive.isDesktop(context);
    final appointments = _apply(state.bookedAppointments);

    final calendar = _CalendarCard();
    final list = _DayListCard(
      appointments: appointments,
      filter: _filter,
      onFilter: (f) => setState(() => _filter = f),
    );

    if (!wide) {
      return Column(
        children: [calendar, const SizedBox(height: Space.lg), list],
      );
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 340, child: calendar),
        const SizedBox(width: Space.lg),
        Expanded(child: list),
      ],
    );
  }
}

class _CalendarCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final month = state.visibleMonth;
    final cells = monthGrid(month);
    final today = DateTime.now();

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  monthYearLabel(month),
                  style: AppType.h2.copyWith(color: c.t1),
                ),
              ),
              AppIconButton(
                icon: Icons.chevron_left_rounded,
                size: 32,
                tooltip: 'Mês anterior',
                onPressed: () => state
                    .showMonth(DateTime(month.year, month.month - 1)),
              ),
              const SizedBox(width: 6),
              AppIconButton(
                icon: Icons.chevron_right_rounded,
                size: 32,
                tooltip: 'Próximo mês',
                onPressed: () => state
                    .showMonth(DateTime(month.year, month.month + 1)),
              ),
            ],
          ),
          const SizedBox(height: Space.lg),
          Row(
            children: ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
                .map((d) => Expanded(
                      child: Center(
                        child: Text(d,
                            style: AppType.caption.copyWith(color: c.t3)),
                      ),
                    ))
                .toList(),
          ),
          const SizedBox(height: Space.sm),
          ...List.generate((cells.length / 7).ceil(), (row) {
            return Row(
              children: List.generate(7, (col) {
                final cell = cells[row * 7 + col];
                if (cell == null) return const Expanded(child: SizedBox(height: 40));
                final selected = isSameDay(cell, state.selectedDate);
                final isToday = isSameDay(cell, today);
                final hasBooking = state.bookedDays.contains(cell.day);
                return Expanded(
                  child: MouseRegion(
                    cursor: SystemMouseCursors.click,
                    child: GestureDetector(
                      onTap: () => state.selectDate(cell),
                      child: Container(
                        height: 40,
                        margin: const EdgeInsets.all(1.5),
                        decoration: BoxDecoration(
                          color: selected ? c.primary : Colors.transparent,
                          borderRadius: BorderRadius.circular(Radii.sm),
                          border: Border.all(
                            color: !selected && isToday
                                ? c.borderStrong
                                : Colors.transparent,
                          ),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              '${cell.day}',
                              style: AppType.small.copyWith(
                                color: selected
                                    ? (context.isDarkMode
                                        ? const Color(0xFF04120D)
                                        : Colors.white)
                                    : c.t1,
                                fontWeight: selected || isToday
                                    ? FontWeight.w600
                                    : FontWeight.w400,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Container(
                              width: 4,
                              height: 4,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: hasBooking
                                    ? (selected
                                        ? (context.isDarkMode
                                            ? const Color(0xFF04120D)
                                            : Colors.white)
                                        : c.primary)
                                    : Colors.transparent,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              }),
            );
          }),
          const AppDivider(vertical: Space.lg),
          Row(
            children: [
              Expanded(
                child: AppButton(
                  label: 'Hoje',
                  variant: ButtonVariant.secondary,
                  size: ButtonSize.small,
                  expand: true,
                  onPressed: () {
                    state.showMonth(DateTime(today.year, today.month));
                    state.selectDate(today);
                  },
                ),
              ),
              const SizedBox(width: Space.sm),
              Expanded(
                child: AppButton(
                  label: 'Amanhã',
                  variant: ButtonVariant.secondary,
                  size: ButtonSize.small,
                  expand: true,
                  onPressed: () => state.selectDate(
                      today.add(const Duration(days: 1))),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _DayListCard extends StatelessWidget {
  final List<Appointment> appointments;
  final AgendaFilter filter;
  final ValueChanged<AgendaFilter> onFilter;

  const _DayListCard({
    required this.appointments,
    required this.filter,
    required this.onFilter,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final total = appointments.fold<int>(0, (s, a) => s + a.priceCents);

    return AppCard(
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
                      relativeDayLabel(state.selectedDate, DateTime.now()),
                      style: AppType.h2.copyWith(color: c.t1),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${appointments.length} ${appointments.length == 1 ? 'atendimento' : 'atendimentos'} · ${formatCurrency(total)}',
                      style: AppType.small.copyWith(color: c.t2),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: Space.lg),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: AgendaFilter.values.map((f) {
                final label = switch (f) {
                  AgendaFilter.todos => 'Todos',
                  AgendaFilter.novos => 'Aguardando',
                  AgendaFilter.confirmados => 'Confirmados',
                  AgendaFilter.atendidos => 'Atendidos',
                };
                final active = f == filter;
                return Padding(
                  padding: const EdgeInsets.only(right: Space.sm),
                  child: MouseRegion(
                    cursor: SystemMouseCursors.click,
                    child: GestureDetector(
                      onTap: () => onFilter(f),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: Space.md, vertical: 7),
                        decoration: BoxDecoration(
                          color: active ? c.primaryWash : c.surf,
                          borderRadius: BorderRadius.circular(Radii.sm),
                          border: Border.all(
                            color: active
                                ? c.primary.withValues(alpha: 0.32)
                                : c.border,
                          ),
                        ),
                        child: Text(
                          label,
                          style: AppType.caption.copyWith(
                            color: active ? c.primaryText : c.t2,
                            fontWeight:
                                active ? FontWeight.w600 : FontWeight.w500,
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: Space.lg),
          if (state.isLoading && appointments.isEmpty)
            const SkeletonList()
          else if (appointments.isEmpty)
            EmptyState(
              icon: Icons.event_busy_outlined,
              title: 'Nada por aqui',
              message: filter == AgendaFilter.todos
                  ? 'Nenhum agendamento para este dia. Quando o agente fechar um horário no WhatsApp, ele aparece aqui na hora.'
                  : 'Nenhum agendamento com esse filtro neste dia.',
            )
          else
            ...appointments.asMap().entries.map(
                  (entry) => StaggeredEntrance(
                    position: entry.key,
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: Space.sm),
                      child: AppointmentRow(appointment: entry.value),
                    ),
                  ),
                ),
        ],
      ),
    );
  }
}

class AppointmentRow extends StatelessWidget {
  final Appointment appointment;
  const AppointmentRow({super.key, required this.appointment});

  Color _accent(BuildContext context) {
    final c = context.colors;
    return switch (appointment.status) {
      AppointmentStatus.completed => c.success,
      AppointmentStatus.confirmed => c.amber,
      AppointmentStatus.scheduled => c.info,
      AppointmentStatus.cancelled => c.t3,
      AppointmentStatus.noShow => c.red,
    };
  }

  BadgeTone get _tone => switch (appointment.status) {
        AppointmentStatus.completed => BadgeTone.success,
        AppointmentStatus.confirmed => BadgeTone.warning,
        AppointmentStatus.scheduled => BadgeTone.info,
        AppointmentStatus.cancelled => BadgeTone.neutral,
        AppointmentStatus.noShow => BadgeTone.danger,
      };

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final accent = _accent(context);
    final compact = Responsive.isMobile(context);

    return AppCard(
      background: c.surf,
      padding: EdgeInsets.zero,
      radius: Radii.md,
      onTap: () => showAppointmentDetail(context, appointment),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(width: 3, color: accent),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(Space.md),
                child: Row(
                  children: [
                    SizedBox(
                      width: 52,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            formatTimeOfDay(appointment.startAt),
                            style: AppType.numericSm.copyWith(color: c.t1),
                          ),
                          Text(
                            formatDuration(appointment.durationMinutes),
                            style: AppType.caption.copyWith(color: c.t3),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: Space.md),
                    Avatar(name: appointment.customerName, size: 34),
                    const SizedBox(width: Space.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  appointment.customerName,
                                  overflow: TextOverflow.ellipsis,
                                  style:
                                      AppType.bodyStrong.copyWith(color: c.t1),
                                ),
                              ),
                              if (appointment.channel ==
                                  BookingChannel.whatsapp) ...[
                                const SizedBox(width: 6),
                                Icon(Icons.chat_bubble_outline_rounded,
                                    size: 12, color: c.t3),
                              ],
                            ],
                          ),
                          const SizedBox(height: 1),
                          Text(
                            appointment.serviceName,
                            overflow: TextOverflow.ellipsis,
                            style: AppType.caption.copyWith(color: c.t2),
                          ),
                        ],
                      ),
                    ),
                    if (!compact) ...[
                      const SizedBox(width: Space.md),
                      StatusBadge(appointment.status.label, tone: _tone),
                    ],
                    const SizedBox(width: Space.md),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          formatCurrency(appointment.priceCents),
                          style: AppType.numericSm.copyWith(color: c.t1),
                        ),
                        if (appointment.prepaid)
                          Text('Pago',
                              style:
                                  AppType.caption.copyWith(color: c.success)),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

void showAppointmentDetail(BuildContext context, Appointment appointment) {
  if (Responsive.hasSidebar(context)) {
    showDialog<void>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.55),
      builder: (_) => Dialog(
        backgroundColor: Colors.transparent,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: AppointmentDetail(appointment: appointment),
        ),
      ),
    );
  } else {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => Padding(
        padding: const EdgeInsets.all(Space.md),
        child: AppointmentDetail(appointment: appointment),
      ),
    );
  }
}

class AppointmentDetail extends StatelessWidget {
  final Appointment appointment;
  const AppointmentDetail({super.key, required this.appointment});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);

    Future<void> setStatus(AppointmentStatus status) async {
      Navigator.of(context).maybePop();
      await state.setAppointmentStatus(appointment.id, status);
    }

    return AppCard(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Avatar(name: appointment.customerName, size: 44),
              const SizedBox(width: Space.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(appointment.customerName,
                        style: AppType.h2.copyWith(color: c.t1)),
                    if (appointment.customerPhone != null)
                      Text(
                        formatPhone(appointment.customerPhone!),
                        style: AppType.caption.copyWith(color: c.t2),
                      ),
                  ],
                ),
              ),
              StatusBadge(
                appointment.channel.label,
                tone: appointment.channel == BookingChannel.whatsapp
                    ? BadgeTone.success
                    : BadgeTone.neutral,
              ),
            ],
          ),
          const AppDivider(vertical: Space.lg),
          _DetailRow(
            icon: Icons.schedule_rounded,
            label: 'Horário',
            value:
                '${formatTimeOfDay(appointment.startAt)} – ${formatTimeOfDay(appointment.endAt)} · ${dayMonthLabel(appointment.startAt)}',
          ),
          _DetailRow(
            icon: Icons.content_cut_rounded,
            label: 'Serviço',
            value: appointment.serviceName,
          ),
          _DetailRow(
            icon: Icons.payments_outlined,
            label: 'Valor',
            value: appointment.prepaid
                ? '${formatCurrency(appointment.priceCents)} · pago antecipado'
                : formatCurrency(appointment.priceCents),
          ),
          if (appointment.notes != null && appointment.notes!.isNotEmpty)
            _DetailRow(
              icon: Icons.sticky_note_2_outlined,
              label: 'Observação',
              value: appointment.notes!,
            ),
          const SizedBox(height: Space.lg),
          if (appointment.status != AppointmentStatus.completed) ...[
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: 'Confirmar',
                    icon: Icons.check_rounded,
                    expand: true,
                    onPressed: appointment.status == AppointmentStatus.confirmed
                        ? null
                        : () => setStatus(AppointmentStatus.confirmed),
                  ),
                ),
                const SizedBox(width: Space.sm),
                Expanded(
                  child: AppButton(
                    label: 'Atendido',
                    icon: Icons.done_all_rounded,
                    variant: ButtonVariant.secondary,
                    expand: true,
                    onPressed: () => setStatus(AppointmentStatus.completed),
                  ),
                ),
              ],
            ),
            const SizedBox(height: Space.sm),
          ],
          Row(
            children: [
              Expanded(
                child: AppButton(
                  label: 'Não compareceu',
                  variant: ButtonVariant.secondary,
                  expand: true,
                  onPressed: () => setStatus(AppointmentStatus.noShow),
                ),
              ),
              const SizedBox(width: Space.sm),
              Expanded(
                child: AppButton(
                  label: 'Cancelar horário',
                  variant: ButtonVariant.danger,
                  expand: true,
                  onPressed: () => setStatus(AppointmentStatus.cancelled),
                ),
              ),
            ],
          ),
          const SizedBox(height: Space.md),
          Text(
            'Ao alterar o status, o agente avisa o cliente pelo WhatsApp automaticamente.',
            style: AppType.caption.copyWith(color: c.t3, height: 1.5),
          ),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: const EdgeInsets.only(bottom: Space.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: c.t2),
          const SizedBox(width: Space.md),
          SizedBox(
            width: 78,
            child: Text(label, style: AppType.caption.copyWith(color: c.t2)),
          ),
          Expanded(
            child: Text(
              value,
              style: AppType.small.copyWith(color: c.t1, height: 1.45),
            ),
          ),
        ],
      ),
    );
  }
}
