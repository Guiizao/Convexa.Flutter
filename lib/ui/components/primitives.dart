import 'package:flutter/material.dart';

import '../../core/formatters.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';
import 'motion.dart';

class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? background;
  final Color? borderColor;
  final double radius;
  final VoidCallback? onTap;

  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(Space.xl),
    this.background,
    this.borderColor,
    this.radius = Radii.lg,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final content = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: background ?? c.card,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: borderColor ?? c.border),
        boxShadow: context.isDarkMode
            ? null
            : [
                BoxShadow(
                  color: c.shadow,
                  blurRadius: 12,
                  offset: const Offset(0, 2),
                ),
              ],
      ),
      child: child,
    );
    if (onTap == null) return content;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(radius),
        child: content,
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final EdgeInsetsGeometry padding;

  const SectionHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.trailing,
    this.padding = const EdgeInsets.only(bottom: Space.lg),
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: padding,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppType.h2.copyWith(color: c.t1)),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(subtitle!, style: AppType.small.copyWith(color: c.t2)),
                ],
              ],
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: Space.md), trailing!],
        ],
      ),
    );
  }
}

class Overline extends StatelessWidget {
  final String text;
  final Color? color;
  const Overline(this.text, {super.key, this.color});

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: AppType.overline.copyWith(color: color ?? context.colors.t2),
    );
  }
}

enum BadgeTone { neutral, primary, success, warning, danger, info }

class StatusBadge extends StatelessWidget {
  final String label;
  final BadgeTone tone;
  final IconData? icon;
  final bool solid;

  const StatusBadge(
    this.label, {
    super.key,
    this.tone = BadgeTone.neutral,
    this.icon,
    this.solid = false,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final (fg, bg) = switch (tone) {
      BadgeTone.primary => (c.primaryText, c.primaryWash),
      BadgeTone.success => (c.success, c.successWash),
      BadgeTone.warning => (c.amber, c.amberWash),
      BadgeTone.danger => (c.red, c.redWash),
      BadgeTone.info => (c.info, c.infoWash),
      BadgeTone.neutral => (c.t2, c.surf),
    };
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: icon == null ? 8 : 7,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        color: solid ? fg : bg,
        borderRadius: BorderRadius.circular(Radii.sm),
        border: solid ? null : Border.all(color: fg.withValues(alpha: 0.22)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 11, color: solid ? c.bg : fg),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: AppType.caption.copyWith(
              color: solid ? c.bg : fg,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class Avatar extends StatelessWidget {
  final String name;
  final double size;
  final Color? tint;

  const Avatar({super.key, required this.name, this.size = 38, this.tint});

  static const _palette = [
    Color(0xFF4C8DFF),
    Color(0xFF00C795),
    Color(0xFFE0973A),
    Color(0xFFB57BFF),
    Color(0xFFEC6A8C),
    Color(0xFF3FBFD4),
  ];

  Color get _color {
    if (tint != null) return tint!;
    var hash = 0;
    for (final unit in name.codeUnits) {
      hash = (hash * 31 + unit) & 0x7FFFFFFF;
    }
    return _palette[hash % _palette.length];
  }

  @override
  Widget build(BuildContext context) {
    final color = _color;
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color.withValues(alpha: 0.14),
        border: Border.all(color: color.withValues(alpha: 0.34)),
      ),
      child: Text(
        initialsOf(name),
        style: TextStyle(
          color: color,
          fontSize: size * 0.36,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.2,
        ),
      ),
    );
  }
}

class AppSwitch extends StatelessWidget {
  final bool value;
  final ValueChanged<bool>? onChanged;

  const AppSwitch({super.key, required this.value, this.onChanged});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final enabled = onChanged != null;
    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: GestureDetector(
        onTap: enabled ? () => onChanged!(!value) : null,
        child: AnimatedContainer(
          duration: context.reactDuration,
          curve: Curves.easeOut,
          width: 42,
          height: 24,
          padding: const EdgeInsets.all(2),
          decoration: BoxDecoration(
            color: value ? c.primary : c.surf,
            borderRadius: BorderRadius.circular(Radii.pill),
            border: Border.all(color: value ? c.primary : c.borderStrong),
          ),
          child: AnimatedAlign(
            duration: context.reactDuration,
            curve: Curves.easeOut,
            alignment: value ? Alignment.centerRight : Alignment.centerLeft,
            child: Container(
              width: 18,
              height: 18,
              decoration: BoxDecoration(
                color: value ? Colors.white : c.t2,
                shape: BoxShape.circle,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class SettingRow extends StatelessWidget {
  final String title;
  final String description;
  final bool value;
  final ValueChanged<bool>? onChanged;
  final Widget? child;

  const SettingRow({
    super.key,
    required this.title,
    required this.description,
    required this.value,
    this.onChanged,
    this.child,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: AppType.h3.copyWith(color: c.t1)),
                  const SizedBox(height: 3),
                  Text(description,
                      style: AppType.small.copyWith(color: c.t2, height: 1.5)),
                ],
              ),
            ),
            const SizedBox(width: Space.lg),
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: AppSwitch(value: value, onChanged: onChanged),
            ),
          ],
        ),
        if (child != null && value) ...[
          const SizedBox(height: Space.lg),
          child!,
        ],
      ],
    );
  }
}

class AppDivider extends StatelessWidget {
  final double vertical;
  const AppDivider({super.key, this.vertical = Space.xl});

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.symmetric(vertical: vertical),
        child: Container(height: 1, color: context.colors.border),
      );
}

class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;
  final Widget? action;
  final EdgeInsetsGeometry padding;

  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
    this.padding = const EdgeInsets.symmetric(vertical: Space.xxxl),
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: padding,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Column(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: c.surf,
                  borderRadius: BorderRadius.circular(Radii.md),
                  border: Border.all(color: c.border),
                ),
                child: Icon(icon, size: 20, color: c.t2),
              ),
              const SizedBox(height: Space.lg),
              Text(title,
                  textAlign: TextAlign.center,
                  style: AppType.h3.copyWith(color: c.t1)),
              const SizedBox(height: 6),
              Text(
                message,
                textAlign: TextAlign.center,
                style: AppType.small.copyWith(color: c.t2, height: 1.55),
              ),
              if (action != null) ...[
                const SizedBox(height: Space.xl),
                action!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

enum BannerTone { info, warning, danger, success }

class InfoBanner extends StatelessWidget {
  final String message;
  final BannerTone tone;
  final IconData? icon;
  final Widget? action;

  const InfoBanner({
    super.key,
    required this.message,
    this.tone = BannerTone.info,
    this.icon,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final (fg, bg) = switch (tone) {
      BannerTone.info => (c.info, c.infoWash),
      BannerTone.warning => (c.amber, c.amberWash),
      BannerTone.danger => (c.red, c.redWash),
      BannerTone.success => (c.success, c.successWash),
    };
    final resolvedIcon = icon ??
        switch (tone) {
          BannerTone.info => Icons.info_outline_rounded,
          BannerTone.warning => Icons.warning_amber_rounded,
          BannerTone.danger => Icons.error_outline_rounded,
          BannerTone.success => Icons.check_circle_outline_rounded,
        };
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: Space.lg, vertical: Space.md),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(Radii.md),
        border: Border.all(color: fg.withValues(alpha: 0.28)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(resolvedIcon, size: 16, color: fg),
          const SizedBox(width: Space.md),
          Expanded(
            child: Text(
              message,
              style: AppType.small.copyWith(color: c.t1, height: 1.5),
            ),
          ),
          if (action != null) ...[const SizedBox(width: Space.md), action!],
        ],
      ),
    );
  }
}

class MetricTile extends StatelessWidget {
  final String label;
  final String value;
  final String? delta;
  final bool? deltaPositive;
  final IconData icon;

  /// Quando [count] e [format] são passados, o número sobe até o valor final
  /// em vez de aparecer pronto. Sem eles, [value] é exibido direto.
  final num? count;
  final String Function(num)? format;

  const MetricTile({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.delta,
    this.deltaPositive,
    this.count,
    this.format,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final deltaColor = deltaPositive == null
        ? c.t2
        : (deltaPositive! ? c.success : c.red);
    return AppCard(
      padding: const EdgeInsets.all(Space.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 15, color: c.t2),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  label,
                  style: AppType.caption.copyWith(color: c.t2),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: Space.md),
          if (count != null && format != null)
            CountUp(
              value: count!,
              format: format!,
              style: AppType.numeric.copyWith(color: c.t1),
            )
          else
            Text(value, style: AppType.numeric.copyWith(color: c.t1)),
          if (delta != null) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                if (deltaPositive != null)
                  Icon(
                    deltaPositive!
                        ? Icons.trending_up_rounded
                        : Icons.trending_down_rounded,
                    size: 13,
                    color: deltaColor,
                  ),
                if (deltaPositive != null) const SizedBox(width: 4),
                Text(delta!, style: AppType.caption.copyWith(color: deltaColor)),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class ResponsiveGrid extends StatelessWidget {
  final List<Widget> children;
  final double minItemWidth;
  final double spacing;
  final double runSpacing;

  const ResponsiveGrid({
    super.key,
    required this.children,
    this.minItemWidth = 220,
    this.spacing = Space.lg,
    this.runSpacing = Space.lg,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final maxWidth = constraints.maxWidth;
        var columns = (maxWidth / minItemWidth).floor();
        if (columns < 1) columns = 1;
        if (columns > children.length) columns = children.length;
        if (columns < 1) return const SizedBox.shrink();
        final itemWidth =
            (maxWidth - spacing * (columns - 1)) / columns;
        return Wrap(
          spacing: spacing,
          runSpacing: runSpacing,
          children: children
              .map((child) => SizedBox(width: itemWidth, child: child))
              .toList(),
        );
      },
    );
  }
}

class LoadingOverlay extends StatelessWidget {
  final String message;
  const LoadingOverlay({super.key, this.message = 'Carregando'});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(strokeWidth: 2, color: c.primary),
          ),
          const SizedBox(height: Space.lg),
          Text(message, style: AppType.small.copyWith(color: c.t2)),
        ],
      ),
    );
  }
}
