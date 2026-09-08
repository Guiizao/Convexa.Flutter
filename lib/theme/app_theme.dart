import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../state/app_state.dart';
import 'tokens.dart';

extension ThemeContext on BuildContext {
  AppColors get colors =>
      AppScope.of(this).isDark ? AppColors.dark : AppColors.light;
  bool get isDarkMode => AppScope.of(this).isDark;
}

ThemeData buildAppTheme(bool isDark) {
  final c = isDark ? AppColors.dark : AppColors.light;
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
