import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../state/app_state.dart';
import 'palettes.dart';
import 'tokens.dart';

extension ThemeContext on BuildContext {
  /// Lê as cores já interpoladas pelo [ColorScope]. Sem ele — em testes, por
  /// exemplo — cai direto no valor final do estado.
  AppColors get colors =>
      ColorScope.maybeOf(this) ?? AppScope.of(this).colors;
  bool get isDarkMode => AppScope.of(this).isDark;
}

/// Distribui as cores animadas para toda a árvore.
class ColorScope extends InheritedWidget {
  final AppColors colors;

  const ColorScope({super.key, required this.colors, required super.child});

  static AppColors? maybeOf(BuildContext context) => context
      .dependOnInheritedWidgetOfExactType<ColorScope>()
      ?.colors;

  @override
  bool updateShouldNotify(ColorScope old) => old.colors != colors;
}

/// Cruza de um tema para o outro token a token, em vez de trocar tudo num
/// quadro só. Vale para claro/escuro e para a troca de paleta.
class AnimatedColors extends StatefulWidget {
  final AppColors target;
  final Widget Function(BuildContext, AppColors) builder;

  const AnimatedColors({
    super.key,
    required this.target,
    required this.builder,
  });

  @override
  State<AnimatedColors> createState() => _AnimatedColorsState();
}

class _AnimatedColorsState extends State<AnimatedColors>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late AppColors _from;
  late AppColors _to;

  @override
  void initState() {
    super.initState();
    _from = widget.target;
    _to = widget.target;
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
      value: 1,
    );
  }

  @override
  void didUpdateWidget(AnimatedColors old) {
    super.didUpdateWidget(old);
    if (widget.target != _to) {
      // Parte de onde a animação está agora, para uma troca no meio de outra
      // não dar salto.
      _from = AppColors.lerp(_from, _to, _controller.value);
      _to = widget.target;
      _controller
        ..value = 0
        ..forward();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final eased = Curves.easeInOutCubic.transform(_controller.value);
        final colors = AppColors.lerp(_from, _to, eased);
        return ColorScope(
          colors: colors,
          child: widget.builder(context, colors),
        );
      },
    );
  }
}

ThemeData buildAppTheme(bool isDark, [AppPalette palette = AppPalette.convexa]) {
  final c = palette.colors(isDark);
  final base = isDark ? ThemeData.dark() : ThemeData.light();

  final textTheme = GoogleFonts.interTextTheme(base.textTheme).apply(
    bodyColor: c.t1,
    displayColor: c.t1,
  );

  return base.copyWith(
    scaffoldBackgroundColor: c.bg,
    canvasColor: c.bg,
    dividerColor: c.border,
    textTheme: textTheme,
    colorScheme: base.colorScheme.copyWith(
      primary: c.primary,
      surface: c.card,
      error: c.red,
    ),
    splashFactory: InkSparkle.splashFactory,
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(
        color: isDark ? c.surfHover : c.t1,
        borderRadius: BorderRadius.circular(Radii.sm),
      ),
      textStyle: AppType.caption.copyWith(color: isDark ? c.t1 : c.bg),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      waitDuration: const Duration(milliseconds: 400),
    ),
    scrollbarTheme: ScrollbarThemeData(
      thumbColor: WidgetStatePropertyAll(c.borderStrong),
      thickness: const WidgetStatePropertyAll(6),
      radius: const Radius.circular(3),
    ),
  );
}
