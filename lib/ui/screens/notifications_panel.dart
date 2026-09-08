import 'package:flutter/material.dart';

import '../../core/formatters.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';
import '../components/buttons.dart';
import '../components/primitives.dart';
import 'agenda_screen.dart';

class NotificationsDialog extends StatelessWidget {
  const NotificationsDialog({super.key});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topRight,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(0, 78, Space.xxl, 0),
        child: Material(
          color: Colors.transparent,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400, maxHeight: 520),
            child: const _NotificationsBody(),
          ),
        ),
      ),
    );
  }
}

class NotificationsSheet extends StatelessWidget {
  const NotificationsSheet({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(Space.md),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.75,
        ),
        child: const _NotificationsBody(),
      ),
    );
  }
}

class _NotificationsBody extends StatelessWidget {
  const _NotificationsBody();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final items = state.notifications;

    return AppCard(
      padding: EdgeInsets.zero,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
                Space.xl, Space.xl, Space.md, Space.md),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Notificações',
                          style: AppType.h2.copyWith(color: c.t1)),
                      Text(
                        items.isEmpty
                            ? 'Tudo em dia'
                            : '${items.length} ${items.length == 1 ? 'aviso' : 'avisos'}',
                        style: AppType.caption.copyWith(color: c.t2),
                      ),
                    ],
                  ),
                ),
                AppIconButton(
                  icon: Icons.close_rounded,
                  size: 32,
                  onPressed: () => Navigator.of(context).maybePop(),
                ),
              ],
            ),
          ),
          Container(height: 1, color: c.border),
          Flexible(
            child: items.isEmpty
                ? EmptyState(
                    icon: Icons.notifications_none_rounded,
                    title: 'Nenhuma novidade',
                    message:
                        'Quando o agente fechar um horário novo ou um cliente cancelar, o aviso aparece aqui.',
                    padding: const EdgeInsets.all(Space.xxl),
                  )
                : ListView.separated(
                    shrinkWrap: true,
                    padding: const EdgeInsets.all(Space.md),
                    itemCount: items.length,
                    separatorBuilder: (_, __) =>
                        const SizedBox(height: Space.sm),
                    itemBuilder: (context, i) =>
                        _NotificationRow(notification: items[i]),
                  ),
          ),
        ],
      ),
    );
  }
}

class _NotificationRow extends StatelessWidget {
  final AppNotification notification;
  const _NotificationRow({required this.notification});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final appointment = notification.appointment;

    return Container(
      padding: const EdgeInsets.all(Space.md),
      decoration: BoxDecoration(
        color: c.surf,
        borderRadius: BorderRadius.circular(Radii.md),
        border: Border.all(color: c.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 30,
                height: 30,
                decoration: BoxDecoration(
                  color: c.primaryWash,
                  borderRadius: BorderRadius.circular(Radii.sm),
                ),
                child: Icon(Icons.event_available_outlined,
                    size: 15, color: c.primaryText),
              ),
              const SizedBox(width: Space.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(notification.title,
                        style: AppType.h3.copyWith(color: c.t1)),
                    const SizedBox(height: 1),
                    Text(notification.body,
                        style: AppType.caption.copyWith(color: c.t2)),
                  ],
                ),
              ),
              InkWell(
                onTap: () => state.dismissNotification(notification.id),
                borderRadius: BorderRadius.circular(4),
                child: Padding(
                  padding: const EdgeInsets.all(3),
                  child: Icon(Icons.close_rounded, size: 14, color: c.t3),
                ),
              ),
            ],
          ),
          if (appointment != null) ...[
            const SizedBox(height: Space.md),
            Container(
              padding: const EdgeInsets.all(Space.md),
              decoration: BoxDecoration(
                color: c.card,
                borderRadius: BorderRadius.circular(Radii.sm),
              ),
              child: Row(
                children: [
                  Icon(Icons.schedule_rounded, size: 13, color: c.t2),
                  const SizedBox(width: 7),
                  Text(
                    formatTimeOfDay(appointment.startAt),
                    style: AppType.caption.copyWith(
                        color: c.t1, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(width: Space.md),
                  Expanded(
                    child: Text(
                      appointment.serviceName,
                      overflow: TextOverflow.ellipsis,
                      style: AppType.caption.copyWith(color: c.t2),
                    ),
                  ),
                  Text(
                    formatCurrency(appointment.priceCents),
                    style: AppType.caption.copyWith(
                        color: c.t1, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
            const SizedBox(height: Space.md),
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: 'Confirmar',
                    size: ButtonSize.small,
                    expand: true,
                    onPressed: () {
                      state.setAppointmentStatus(
                          appointment.id, AppointmentStatus.confirmed);
                      state.dismissNotification(notification.id);
                    },
                  ),
                ),
                const SizedBox(width: Space.sm),
                Expanded(
                  child: AppButton(
                    label: 'Ver detalhes',
                    variant: ButtonVariant.secondary,
                    size: ButtonSize.small,
                    expand: true,
                    onPressed: () {
                      Navigator.of(context).maybePop();
                      showAppointmentDetail(context, appointment);
                    },
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
