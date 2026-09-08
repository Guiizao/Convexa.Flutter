import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';

enum ButtonVariant { primary, secondary, ghost, danger }
enum ButtonSize { small, medium, large }

class AppButton extends StatefulWidget {
  final String label;
  final VoidCallback? onPressed;
  final ButtonVariant variant;
  final ButtonSize size;
  final IconData? icon;
  final bool loading;
  final bool expand;

  const AppButton({
    super.key,
    required this.label,
    this.onPressed,
    this.variant = ButtonVariant.primary,
    this.size = ButtonSize.medium,
    this.icon,
    this.loading = false,
    this.expand = false,
  });

  @override
  State<AppButton> createState() => _AppButtonState();
}

class _AppButtonState extends State<AppButton> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final enabled = widget.onPressed != null && !widget.loading;

    final (height, hPad, textStyle) = switch (widget.size) {
      ButtonSize.small => (34.0, Space.md, AppType.caption),
      ButtonSize.medium => (42.0, Space.lg, AppType.bodyStrong),
      ButtonSize.large => (50.0, Space.xl, AppType.bodyStrong),
    };

    late final Color background;
    late final Color foreground;
    late final Color? borderColor;

    switch (widget.variant) {
      case ButtonVariant.primary:
        background = _hovered && enabled
            ? Color.lerp(c.primary, Colors.white, 0.12)!
            : c.primary;
        foreground = context.isDarkMode ? const Color(0xFF04120D) : Colors.white;
        borderColor = null;
      case ButtonVariant.secondary:
        background = _hovered && enabled ? c.surfHover : c.surf;
        foreground = c.t1;
        borderColor = c.borderStrong;
      case ButtonVariant.ghost:
        background = _hovered && enabled ? c.surf : Colors.transparent;
        foreground = c.t2;
        borderColor = Colors.transparent;
      case ButtonVariant.danger:
        background = _hovered && enabled ? c.red.withValues(alpha: 0.18) : c.redWash;
        foreground = c.red;
        borderColor = c.red.withValues(alpha: 0.32);
    }

    final child = Row(
      mainAxisSize: widget.expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (widget.loading)
          SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2, color: foreground),
          )
        else if (widget.icon != null)
          Icon(widget.icon, size: widget.size == ButtonSize.small ? 14 : 16,
              color: foreground),
        if (widget.loading || widget.icon != null) const SizedBox(width: 8),
        Flexible(
          child: Text(
            widget.label,
            overflow: TextOverflow.ellipsis,
            style: textStyle.copyWith(
              color: foreground,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    );

    return MouseRegion(
      cursor: enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        onTap: enabled ? widget.onPressed : null,
        child: AnimatedOpacity(
          duration: const Duration(milliseconds: 140),
          opacity: enabled ? 1 : 0.45,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 140),
            height: height,
            width: widget.expand ? double.infinity : null,
            padding: EdgeInsets.symmetric(horizontal: hPad),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: background,
              borderRadius: BorderRadius.circular(Radii.md),
              border: borderColor == null
                  ? null
                  : Border.all(color: borderColor),
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}

class AppIconButton extends StatefulWidget {
  final IconData icon;
  final VoidCallback? onPressed;
  final String? tooltip;
  final double size;
  final Color? color;
  final int badgeCount;

  const AppIconButton({
    super.key,
    required this.icon,
    this.onPressed,
    this.tooltip,
    this.size = 38,
    this.color,
    this.badgeCount = 0,
  });

  @override
  State<AppIconButton> createState() => _AppIconButtonState();
}

class _AppIconButtonState extends State<AppIconButton> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final button = MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        onTap: widget.onPressed,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 140),
          width: widget.size,
          height: widget.size,
          decoration: BoxDecoration(
            color: _hovered ? c.surfHover : c.surf,
            borderRadius: BorderRadius.circular(Radii.md),
            border: Border.all(color: _hovered ? c.borderStrong : c.border),
          ),
          child: Stack(
            alignment: Alignment.center,
            clipBehavior: Clip.none,
            children: [
              Icon(widget.icon,
                  size: widget.size * 0.44, color: widget.color ?? c.t2),
              if (widget.badgeCount > 0)
                Positioned(
                  top: -3,
                  right: -3,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    constraints: const BoxConstraints(minWidth: 16),
                    height: 16,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: c.red,
                      borderRadius: BorderRadius.circular(Radii.pill),
                      border: Border.all(color: c.bg, width: 1.5),
                    ),
                    child: Text(
                      widget.badgeCount > 9 ? '9+' : '${widget.badgeCount}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        height: 1,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );

    if (widget.tooltip == null) return button;
    return Tooltip(message: widget.tooltip!, child: button);
  }
}
