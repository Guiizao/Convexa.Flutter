import 'package:flutter/material.dart';

import '../../core/date_utils.dart';
import '../../core/formatters.dart';
import '../../core/launch_options.dart';
import '../../core/responsive.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';
import '../brand/logo.dart';
import '../components/buttons.dart';
import '../components/motion.dart';
import '../components/primitives.dart';
import 'agenda_screen.dart';
import 'automacao_screen.dart';
import 'configuracoes_screen.dart';
import 'dashboard_screen.dart';
import 'encerrar_screen.dart';
import 'equipe_screen.dart';
import 'expediente_screen.dart';
import 'notifications_panel.dart';
import 'servicos_screen.dart';

class NavDestination {
  final String label;
  final IconData icon;
  final IconData activeIcon;
  final Widget Function() build;

  const NavDestination({
    required this.label,
    required this.icon,
    required this.activeIcon,
    required this.build,
  });
}

final navDestinations = <NavDestination>[
  NavDestination(
    label: 'Expediente',
    icon: Icons.play_circle_outline_rounded,
    activeIcon: Icons.play_circle_filled_rounded,
    build: () => const ExpedienteScreen(),
  ),
  NavDestination(
    label: 'Agenda',
    icon: Icons.calendar_today_outlined,
    activeIcon: Icons.calendar_today_rounded,
    build: () => const AgendaScreen(),
  ),
  NavDestination(
    label: 'Serviços',
    icon: Icons.content_cut_outlined,
    activeIcon: Icons.content_cut_rounded,
    build: () => const ServicosScreen(),
  ),
  NavDestination(
    label: 'Resultados',
    icon: Icons.insights_outlined,
    activeIcon: Icons.insights_rounded,
    build: () => const DashboardScreen(),
  ),
  NavDestination(
    label: 'Encerrar',
    icon: Icons.nightlight_outlined,
    activeIcon: Icons.nightlight_round,
    build: () => const EncerrarScreen(),
  ),
  NavDestination(
    label: 'Equipe',
    icon: Icons.groups_outlined,
    activeIcon: Icons.groups_rounded,
    build: () => const EquipeScreen(),
  ),
  NavDestination(
    label: 'Automação',
    icon: Icons.forum_outlined,
    activeIcon: Icons.forum_rounded,
    build: () => const AutomacaoScreen(),
  ),
  NavDestination(
    label: 'Configurações',
    icon: Icons.tune_rounded,
    activeIcon: Icons.tune_rounded,
    build: () => const ConfiguracoesScreen(),
  ),
];

class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key});

  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  int _index = _initialIndex();
  ValueNotifier<String?>? _tabRequest;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = AppScope.read(context).tabRequest;
    if (identical(next, _tabRequest)) return;
    _tabRequest?.removeListener(_onTabRequest);
    _tabRequest = next..addListener(_onTabRequest);
  }

  @override
  void dispose() {
    _tabRequest?.removeListener(_onTabRequest);
    super.dispose();
  }

  void _onTabRequest() {
    final label = _tabRequest?.value;
    if (label == null) return;
    final i = navDestinations.indexWhere((d) => d.label == label);
    if (i >= 0 && mounted) setState(() => _index = i);
  }

  static int _initialIndex() {
    final tab = LaunchOptions.tab;
    if (tab == null) return 1;
    final n = int.tryParse(tab);
    if (n != null && n >= 0 && n < navDestinations.length) return n;
    String fold(String s) => s
        .toLowerCase()
        .replaceAll(RegExp('[áàâã]'), 'a')
        .replaceAll(RegExp('[éê]'), 'e')
        .replaceAll('í', 'i')
        .replaceAll(RegExp('[óôõ]'), 'o')
        .replaceAll('ú', 'u')
        .replaceAll('ç', 'c');
    final i = navDestinations.indexWhere((d) => fold(d.label) == fold(tab));
    return i >= 0 ? i : 1;
  }
  bool _railExpanded = true;

  static const _mobilePrimary = [0, 1, 2, 3];

  void _select(int index) => setState(() => _index = index);

  void _openNotifications() {
    final state = AppScope.read(context);
    state.markNotificationsRead();
    if (Responsive.hasSidebar(context)) {
      showDialog<void>(
        context: context,
        barrierColor: Colors.black.withValues(alpha: 0.55),
        builder: (_) => const NotificationsDialog(),
      );
    } else {
      showModalBottomSheet<void>(
        context: context,
        backgroundColor: Colors.transparent,
        isScrollControlled: true,
        builder: (_) => const NotificationsSheet(),
      );
    }
  }

  void _openMoreMenu() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) {
        final c = context.colors;
        final extras = [
          for (var i = 0; i < navDestinations.length; i++)
            if (!_mobilePrimary.contains(i)) i
        ];
        return Container(
          margin: const EdgeInsets.all(Space.md),
          padding: const EdgeInsets.all(Space.sm),
          decoration: BoxDecoration(
            color: c.card,
            borderRadius: BorderRadius.circular(Radii.xl),
            border: Border.all(color: c.border),
          ),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: extras.map((i) {
                final dest = navDestinations[i];
                return ListTile(
                  leading: Icon(dest.icon, size: 19, color: c.t2),
                  title: Text(dest.label,
                      style: AppType.bodyStrong.copyWith(color: c.t1)),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(Radii.md)),
                  onTap: () {
                    Navigator.of(sheetContext).pop();
                    _select(i);
                  },
                );
              }).toList(),
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Responsive.hasSidebar(context) ? _buildWide() : _buildCompact();
  }

  Widget _buildWide() {
    final c = context.colors;
    final expanded = _railExpanded && Responsive.isDesktop(context);
    return Scaffold(
      backgroundColor: c.bg,
      body: Row(
        children: [
          _SideRail(
            index: _index,
            expanded: expanded,
            onSelect: _select,
            onToggle: () => setState(() => _railExpanded = !_railExpanded),
            canToggle: Responsive.isDesktop(context),
          ),
          Expanded(
            child: Column(
              children: [
                _TopBar(
                  title: navDestinations[_index].label,
                  onNotifications: _openNotifications,
                ),
                Expanded(
                  child: Scrollbar(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(
                          Space.xxl, Space.xl, Space.xxl, Space.xxxl),
                      child: Center(
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 1200),
                          child: ScreenTransition(
                            index: _index,
                            child: navDestinations[_index].build(),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCompact() {
    final c = context.colors;
    return Scaffold(
      backgroundColor: c.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _CompactTopBar(
              title: navDestinations[_index].label,
              onNotifications: _openNotifications,
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                    Space.lg, Space.md, Space.lg, Space.xxxl),
                child: ScreenTransition(
                  index: _index,
                  child: navDestinations[_index].build(),
                ),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: _BottomBar(
        index: _index,
        primary: _mobilePrimary,
        onSelect: _select,
        onMore: _openMoreMenu,
      ),
    );
  }
}

class _SideRail extends StatelessWidget {
  final int index;
  final bool expanded;
  final bool canToggle;
  final ValueChanged<int> onSelect;
  final VoidCallback onToggle;

  const _SideRail({
    required this.index,
    required this.expanded,
    required this.canToggle,
    required this.onSelect,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);

    return AnimatedContainer(
      duration: context.reactDuration,
      curve: Curves.easeOut,
      width: expanded ? 232 : 72,
      decoration: BoxDecoration(
        color: c.bgElevated,
        border: Border(right: BorderSide(color: c.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Recolhido, a marca fica centrada na coluna como os ícones; antes
          // herdava o padding do modo expandido e ficava torta.
          SizedBox(
            height: 72,
            child: Padding(
              padding: EdgeInsets.symmetric(
                  horizontal: expanded ? Space.xl : 0),
              child: Align(
                alignment:
                    expanded ? Alignment.centerLeft : Alignment.center,
                child: expanded
                    ? const ConvexaLogo(size: 24)
                    : const ConvexaMark(size: 26),
              ),
            ),
          ),
          Expanded(
            child: ListView.builder(
              padding: EdgeInsets.symmetric(
                  horizontal: expanded ? Space.md : Space.md),
              itemCount: navDestinations.length,
              itemBuilder: (context, i) => _RailItem(
                destination: navDestinations[i],
                active: i == index,
                expanded: expanded,
                onTap: () => onSelect(i),
              ),
            ),
          ),
          Padding(
            padding: EdgeInsets.symmetric(
                horizontal: expanded ? Space.md : Space.sm,
                vertical: Space.md),
            child: Column(
              crossAxisAlignment: expanded
                  ? CrossAxisAlignment.start
                  : CrossAxisAlignment.center,
              children: [
                if (state.demoMode) ...[
                  if (expanded)
                    const StatusBadge('Modo demonstração',
                        tone: BadgeTone.warning, icon: Icons.science_outlined)
                  else
                    Tooltip(
                      message: 'Modo demonstração',
                      child: Container(
                        width: 30,
                        height: 30,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: c.amberWash,
                          borderRadius: BorderRadius.circular(Radii.sm),
                        ),
                        child: Icon(Icons.science_outlined,
                            size: 15, color: c.amber),
                      ),
                    ),
                  const SizedBox(height: Space.md),
                ],
                Container(height: 1, color: c.border),
                const SizedBox(height: Space.md),
                _RailFooter(expanded: expanded),
                if (canToggle) ...[
                  const SizedBox(height: Space.sm),
                  MouseRegion(
                    cursor: SystemMouseCursors.click,
                    child: GestureDetector(
                      onTap: onToggle,
                      child: Container(
                        height: 30,
                        width: expanded ? double.infinity : 30,
                        alignment: expanded
                            ? Alignment.centerLeft
                            : Alignment.center,
                        padding: EdgeInsets.symmetric(
                            horizontal: expanded ? Space.sm : 0),
                        child: Icon(
                          expanded
                              ? Icons.keyboard_double_arrow_left_rounded
                              : Icons.keyboard_double_arrow_right_rounded,
                          size: 16,
                          color: c.t3,
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RailItem extends StatefulWidget {
  final NavDestination destination;
  final bool active;
  final bool expanded;
  final VoidCallback onTap;

  const _RailItem({
    required this.destination,
    required this.active,
    required this.expanded,
    required this.onTap,
  });

  @override
  State<_RailItem> createState() => _RailItemState();
}

class _RailItemState extends State<_RailItem> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final active = widget.active;

    final content = AnimatedContainer(
      duration: context.reactDuration,
      height: 42,
      margin: const EdgeInsets.only(bottom: 3),
      padding: EdgeInsets.symmetric(
          horizontal: widget.expanded ? Space.md : 0),
      decoration: BoxDecoration(
        color: active
            ? c.primaryWash
            : (_hovered ? c.surf : Colors.transparent),
        borderRadius: BorderRadius.circular(Radii.md),
        border: Border.all(
          color: active ? c.primary.withValues(alpha: 0.3) : Colors.transparent,
        ),
      ),
      child: Row(
        mainAxisAlignment: widget.expanded
            ? MainAxisAlignment.start
            : MainAxisAlignment.center,
        children: [
          Icon(
            active ? widget.destination.activeIcon : widget.destination.icon,
            size: 18,
            color: active ? c.primaryText : c.t2,
          ),
          if (widget.expanded) ...[
            const SizedBox(width: Space.md),
            Expanded(
              child: Text(
                widget.destination.label,
                overflow: TextOverflow.ellipsis,
                style: AppType.bodyStrong.copyWith(
                  color: active ? c.t1 : c.t2,
                  fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                ),
              ),
            ),
          ],
        ],
      ),
    );

    final item = MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(onTap: widget.onTap, child: content),
    );

    return widget.expanded
        ? item
        : Tooltip(message: widget.destination.label, child: item);
  }
}

class _RailFooter extends StatelessWidget {
  final bool expanded;
  const _RailFooter({required this.expanded});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final session = state.session;

    if (!expanded) {
      // Tudo com a mesma largura de 30, para a coluna ficar num eixo só.
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Tooltip(
            message: session?.businessName ?? 'Conta',
            child: Avatar(name: session?.userName ?? 'Convexa', size: 30),
          ),
          const SizedBox(height: Space.sm),
          AppIconButton(
            icon: state.isDark
                ? Icons.light_mode_outlined
                : Icons.dark_mode_outlined,
            size: 30,
            tooltip: state.isDark ? 'Tema claro' : 'Tema escuro',
            onPressed: state.toggleTheme,
          ),
          const SizedBox(height: Space.sm),
          AppIconButton(
            icon: Icons.logout_rounded,
            size: 30,
            tooltip: 'Sair',
            onPressed: state.signOut,
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Row(
            children: [
              Avatar(name: session?.userName ?? 'Convexa', size: 32),
              const SizedBox(width: Space.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      session?.businessName.isNotEmpty == true
                          ? session!.businessName
                          : 'Estabelecimento',
                      overflow: TextOverflow.ellipsis,
                      style: AppType.caption.copyWith(
                          color: c.t1, fontWeight: FontWeight.w600),
                    ),
                    Text(
                      session?.userEmail ?? '',
                      overflow: TextOverflow.ellipsis,
                      style: AppType.caption.copyWith(color: c.t3),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: Space.md),
        Row(
          children: [
            Expanded(
              child: AppButton(
                label: state.isDark ? 'Claro' : 'Escuro',
                icon: state.isDark
                    ? Icons.light_mode_outlined
                    : Icons.dark_mode_outlined,
                variant: ButtonVariant.ghost,
                size: ButtonSize.small,
                onPressed: state.toggleTheme,
              ),
            ),
            const SizedBox(width: Space.sm),
            AppIconButton(
              icon: Icons.logout_rounded,
              size: 34,
              tooltip: 'Sair da conta',
              onPressed: state.signOut,
            ),
          ],
        ),
      ],
    );
  }
}

class _TopBar extends StatelessWidget {
  final String title;
  final VoidCallback onNotifications;

  const _TopBar({required this.title, required this.onNotifications});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);

    return Container(
      height: 66,
      padding: const EdgeInsets.symmetric(horizontal: Space.xxl),
      decoration: BoxDecoration(
        color: c.bgElevated,
        border: Border(bottom: BorderSide(color: c.border)),
      ),
      child: Row(
        children: [
          Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: AppType.h2.copyWith(color: c.t1)),
              Text(
                fullDateLabel(state.selectedDate),
                style: AppType.caption.copyWith(color: c.t2),
              ),
            ],
          ),
          const Spacer(),
          const _SyncLabel(),
          const SizedBox(width: Space.md),
          const ShiftIndicator(),
          const SizedBox(width: Space.md),
          AppIconButton(
            icon: Icons.refresh_rounded,
            tooltip: 'Atualizar dados',
            loading: state.isRefreshing,
            onPressed: state.refresh,
          ),
          const SizedBox(width: Space.sm),
          AppIconButton(
            icon: Icons.notifications_none_rounded,
            tooltip: 'Notificações',
            badgeCount: state.unreadCount,
            onPressed: onNotifications,
          ),
        ],
      ),
    );
  }
}

class _CompactTopBar extends StatelessWidget {
  final String title;
  final VoidCallback onNotifications;

  const _CompactTopBar({required this.title, required this.onNotifications});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);

    return Container(
      padding: const EdgeInsets.fromLTRB(Space.lg, Space.md, Space.lg, Space.md),
      decoration: BoxDecoration(
        color: c.bgElevated,
        border: Border(bottom: BorderSide(color: c.border)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const ConvexaMark(size: 22),
              const SizedBox(width: Space.md),
              Expanded(
                child: Text(
                  title,
                  style: AppType.h2.copyWith(color: c.t1),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              AppIconButton(
                icon: Icons.refresh_rounded,
                size: 34,
                loading: state.isRefreshing,
                onPressed: state.refresh,
              ),
              const SizedBox(width: Space.sm),
              AppIconButton(
                icon: state.isDark
                    ? Icons.light_mode_outlined
                    : Icons.dark_mode_outlined,
                size: 34,
                onPressed: state.toggleTheme,
              ),
              const SizedBox(width: Space.sm),
              AppIconButton(
                icon: Icons.notifications_none_rounded,
                size: 34,
                badgeCount: state.unreadCount,
                onPressed: onNotifications,
              ),
              const SizedBox(width: Space.sm),
              AppIconButton(
                icon: Icons.logout_rounded,
                size: 34,
                onPressed: state.signOut,
              ),
            ],
          ),
          const SizedBox(height: Space.md),
          Row(
            children: [
              const ShiftIndicator(),
              const Spacer(),
              Text(
                relativeDayLabel(state.selectedDate, DateTime.now()),
                style: AppType.caption.copyWith(color: c.t2),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class ShiftIndicator extends StatelessWidget {
  const ShiftIndicator({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return switch (state.shift.state) {
      ShiftState.open => const StatusBadge(
          'Expediente aberto',
          tone: BadgeTone.success,
          icon: Icons.circle,
        ),
      ShiftState.finished => const StatusBadge(
          'Dia encerrado',
          tone: BadgeTone.neutral,
          icon: Icons.check_rounded,
        ),
      ShiftState.closed => const StatusBadge(
          'Expediente fechado',
          tone: BadgeTone.warning,
          icon: Icons.circle_outlined,
        ),
    };
  }
}

class _BottomBar extends StatelessWidget {
  final int index;
  final List<int> primary;
  final ValueChanged<int> onSelect;
  final VoidCallback onMore;

  const _BottomBar({
    required this.index,
    required this.primary,
    required this.onSelect,
    required this.onMore,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final isExtra = !primary.contains(index);

    return Container(
      decoration: BoxDecoration(
        color: c.bgElevated,
        border: Border(top: BorderSide(color: c.border)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 62,
          child: Row(
            children: [
              ...primary.map((i) => Expanded(
                    child: _BottomItem(
                      destination: navDestinations[i],
                      active: i == index,
                      onTap: () => onSelect(i),
                    ),
                  )),
              Expanded(
                child: _BottomItem(
                  destination: NavDestination(
                    label: 'Mais',
                    icon: Icons.more_horiz_rounded,
                    activeIcon: Icons.more_horiz_rounded,
                    build: () => const SizedBox.shrink(),
                  ),
                  active: isExtra,
                  onTap: onMore,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BottomItem extends StatelessWidget {
  final NavDestination destination;
  final bool active;
  final VoidCallback onTap;

  const _BottomItem({
    required this.destination,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AnimatedContainer(
            duration: context.reactDuration,
            width: 30,
            height: 3,
            margin: const EdgeInsets.only(bottom: 7),
            decoration: BoxDecoration(
              color: active ? c.primary : Colors.transparent,
              borderRadius: BorderRadius.circular(Radii.pill),
            ),
          ),
          Icon(
            active ? destination.activeIcon : destination.icon,
            size: 19,
            color: active ? c.primaryText : c.t2,
          ),
          const SizedBox(height: 3),
          Text(
            destination.label,
            style: AppType.caption.copyWith(
              color: active ? c.t1 : c.t2,
              fontSize: 10,
              fontWeight: active ? FontWeight.w600 : FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _SyncLabel extends StatelessWidget {
  const _SyncLabel();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final synced = state.lastSyncedAt;
    if (synced == null) return const SizedBox.shrink();

    final minutes = DateTime.now().difference(synced).inMinutes;
    final label = minutes < 1
        ? 'Atualizado agora'
        : (minutes < 60
            ? 'Atualizado há ${minutes}min'
            : 'Atualizado às ${formatTimeOfDay(synced)}');

    return Text(label, style: AppType.caption.copyWith(color: c.t3));
  }
}
