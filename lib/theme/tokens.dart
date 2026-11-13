import 'package:flutter/material.dart';

class AppColors {
  final Color bg;
  final Color bgElevated;
  final Color card;
  final Color surf;
  final Color surfHover;
  final Color border;
  final Color borderStrong;
  final Color primary;
  final Color primaryText;
  final Color primaryWash;
  /// Texto e ícone sobre a cor primária (botão principal, chip selecionado).
  final Color onPrimary;
  final Color amber;
  final Color amberWash;
  final Color red;
  final Color redWash;
  final Color success;
  final Color successWash;
  final Color info;
  final Color infoWash;
  final Color t1;
  final Color t2;
  final Color t3;
  final Color shadow;

  const AppColors({
    required this.bg,
    required this.bgElevated,
    required this.card,
    required this.surf,
    required this.surfHover,
    required this.border,
    required this.borderStrong,
    required this.primary,
    required this.primaryText,
    required this.primaryWash,
    this.onPrimary = const Color(0xFFFFFFFF),
    required this.amber,
    required this.amberWash,
    required this.red,
    required this.redWash,
    required this.success,
    required this.successWash,
    required this.info,
    required this.infoWash,
    required this.t1,
    required this.t2,
    required this.t3,
    required this.shadow,
  });


  /// Interpola token a token, para a troca de tema ser uma transição e não um
  /// corte seco. Usado pelo ColorScope no topo da árvore.
  static AppColors lerp(AppColors a, AppColors b, double t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    return AppColors(
        bg: Color.lerp(a.bg, b.bg, t)!,
        bgElevated: Color.lerp(a.bgElevated, b.bgElevated, t)!,
        card: Color.lerp(a.card, b.card, t)!,
        surf: Color.lerp(a.surf, b.surf, t)!,
        surfHover: Color.lerp(a.surfHover, b.surfHover, t)!,
        border: Color.lerp(a.border, b.border, t)!,
        borderStrong: Color.lerp(a.borderStrong, b.borderStrong, t)!,
        primary: Color.lerp(a.primary, b.primary, t)!,
        primaryText: Color.lerp(a.primaryText, b.primaryText, t)!,
        primaryWash: Color.lerp(a.primaryWash, b.primaryWash, t)!,
        onPrimary: Color.lerp(a.onPrimary, b.onPrimary, t)!,
        amber: Color.lerp(a.amber, b.amber, t)!,
        amberWash: Color.lerp(a.amberWash, b.amberWash, t)!,
        red: Color.lerp(a.red, b.red, t)!,
        redWash: Color.lerp(a.redWash, b.redWash, t)!,
        success: Color.lerp(a.success, b.success, t)!,
        successWash: Color.lerp(a.successWash, b.successWash, t)!,
        info: Color.lerp(a.info, b.info, t)!,
        infoWash: Color.lerp(a.infoWash, b.infoWash, t)!,
        t1: Color.lerp(a.t1, b.t1, t)!,
        t2: Color.lerp(a.t2, b.t2, t)!,
        t3: Color.lerp(a.t3, b.t3, t)!,
        shadow: Color.lerp(a.shadow, b.shadow, t)!,
    );
  }

  static const AppColors dark = AppColors(
    bg: Color(0xFF040A06),
    bgElevated: Color(0xFF070F0A),
    card: Color(0xFF0A140E),
    surf: Color(0xFF111C15),
    surfHover: Color(0xFF17261C),
    border: Color(0xFF1B2A20),
    borderStrong: Color(0xFF2B4234),
    primary: Color(0xFF2BD96B),
    primaryText: Color(0xFF5CE88C),
    primaryWash: Color(0x1F2BD96B),
    onPrimary: Color(0xFF04120D),
    amber: Color(0xFFE0973A),
    amberWash: Color(0x1AE0973A),
    red: Color(0xFFE55A5A),
    redWash: Color(0x1AE55A5A),
    success: Color(0xFF35C97F),
    successWash: Color(0x1A35C97F),
    info: Color(0xFF5B8DEF),
    infoWash: Color(0x1A5B8DEF),
    t1: Color(0xFFEAF2EC),
    t2: Color(0xFF84968B),
    t3: Color(0xFF4B5E52),
    shadow: Color(0x66000000),
  );

  static const AppColors light = AppColors(
    bg: Color(0xFFF5F8F6),
    bgElevated: Color(0xFFFFFFFF),
    card: Color(0xFFFFFFFF),
    surf: Color(0xFFEFF4F1),
    surfHover: Color(0xFFE4ECE7),
    border: Color(0xFFDFE7E2),
    borderStrong: Color(0xFFC4D2C9),
    primary: Color(0xFF12833F),
    primaryText: Color(0xFF0D6B33),
    primaryWash: Color(0x1412833F),
    amber: Color(0xFF9C6212),
    amberWash: Color(0x149C6212),
    red: Color(0xFFB93030),
    redWash: Color(0x14B93030),
    success: Color(0xFF1B8B54),
    successWash: Color(0x141B8B54),
    info: Color(0xFF2F5FBF),
    infoWash: Color(0x142F5FBF),
    t1: Color(0xFF0F1712),
    t2: Color(0xFF57665C),
    t3: Color(0xFF95A69B),
    shadow: Color(0x14000000),
  );
}

/// Duração única de reação a interação — hover, foco, seleção.
///
/// Cada componente tinha a sua (140, 150, 160, 170, 180, 200ms). Como todos
/// perseguem a cor que o [AnimatedColors] interpola, cada um chegava ao valor
/// novo num instante diferente e a troca de tema parecia escalonada.
const Duration kReact = Duration(milliseconds: 140);

class Space {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;
  static const double xxxl = 48;
}

class Radii {
  static const double sm = 6;
  static const double md = 10;
  static const double lg = 14;
  static const double xl = 20;
  static const double pill = 999;
}

class AppType {
  static const TextStyle display = TextStyle(
    fontSize: 30,
    height: 1.15,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.8,
  );
  static const TextStyle h1 = TextStyle(
    fontSize: 22,
    height: 1.2,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.4,
  );
  static const TextStyle h2 = TextStyle(
    fontSize: 17,
    height: 1.25,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
  );
  static const TextStyle h3 = TextStyle(
    fontSize: 14,
    height: 1.3,
    fontWeight: FontWeight.w600,
  );
  static const TextStyle body = TextStyle(
    fontSize: 14,
    height: 1.45,
    fontWeight: FontWeight.w400,
  );
  static const TextStyle bodyStrong = TextStyle(
    fontSize: 14,
    height: 1.45,
    fontWeight: FontWeight.w500,
  );
  static const TextStyle small = TextStyle(
    fontSize: 12.5,
    height: 1.4,
    fontWeight: FontWeight.w400,
  );
  static const TextStyle caption = TextStyle(
    fontSize: 11,
    height: 1.3,
    fontWeight: FontWeight.w500,
  );
  static const TextStyle overline = TextStyle(
    fontSize: 10,
    height: 1.2,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.9,
  );
  static const TextStyle numeric = TextStyle(
    fontSize: 26,
    height: 1.1,
    fontWeight: FontWeight.w600,
    letterSpacing: -1.0,
    fontFeatures: [FontFeature.tabularFigures()],
  );
  static const TextStyle numericSm = TextStyle(
    fontSize: 15,
    height: 1.2,
    fontWeight: FontWeight.w600,
    fontFeatures: [FontFeature.tabularFigures()],
  );
}
