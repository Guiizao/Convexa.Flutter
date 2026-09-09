import 'package:flutter/material.dart';

import 'tokens.dart';

/// Paletas disponíveis no painel.
///
/// Cada uma define só o essencial — fundo, superfícies, acento e texto. As
/// cores semânticas (aviso, erro, sucesso, informação) são compartilhadas por
/// claridade: verde sempre significa concluído, âmbar sempre significa
/// atenção. Se elas mudassem junto com a paleta, o usuário teria que reaprender
/// o significado de cada cor ao trocar de tema.
enum AppPalette {
  convexa('Convexa', 'Verde da marca'),
  grafite('Grafite', 'Neutro com acento âmbar'),
  indigo('Índigo', 'Azul profundo, sóbrio'),
  ardosia('Ardósia', 'Cinza-azulado com ciano'),
  vinho('Vinho', 'Quente e discreto');

  final String label;
  final String description;

  const AppPalette(this.label, this.description);

  AppColors colors(bool dark) => dark ? _dark[this]! : _light[this]!;

  /// Amostra usada no seletor: fundo, superfície e acento.
  List<Color> get swatch {
    final c = colors(true);
    return [c.bg, c.surf, c.primary];
  }
}

/// Semânticas do tema escuro. Iguais em todas as paletas, de propósito.
const _dSuccess = Color(0xFF35C97F);
const _dAmber = Color(0xFFE0A33A);
const _dRed = Color(0xFFE55A5A);
const _dInfo = Color(0xFF5B8DEF);

const _lSuccess = Color(0xFF1B8B54);
const _lAmber = Color(0xFF9A6B10);
const _lRed = Color(0xFFB93030);
const _lInfo = Color(0xFF2F5FBF);

AppColors _mk({
  required bool dark,
  required Color bg,
  required Color bgElevated,
  required Color card,
  required Color surf,
  required Color surfHover,
  required Color border,
  required Color borderStrong,
  required Color primary,
  required Color primaryText,
  required Color t1,
  required Color t2,
  required Color t3,
}) {
  Color wash(Color c) => c.withValues(alpha: dark ? 0.12 : 0.09);
  return AppColors(
    bg: bg,
    bgElevated: bgElevated,
    card: card,
    surf: surf,
    surfHover: surfHover,
    border: border,
    borderStrong: borderStrong,
    primary: primary,
    primaryText: primaryText,
    primaryWash: wash(primary),
    amber: dark ? _dAmber : _lAmber,
    amberWash: wash(dark ? _dAmber : _lAmber),
    red: dark ? _dRed : _lRed,
    redWash: wash(dark ? _dRed : _lRed),
    success: dark ? _dSuccess : _lSuccess,
    successWash: wash(dark ? _dSuccess : _lSuccess),
    info: dark ? _dInfo : _lInfo,
    infoWash: wash(dark ? _dInfo : _lInfo),
    t1: t1,
    t2: t2,
    t3: t3,
    shadow: dark ? const Color(0x66000000) : const Color(0x14000000),
  );
}

final Map<AppPalette, AppColors> _dark = {
  AppPalette.convexa: _mk(
    dark: true,
    bg: const Color(0xFF040A06),
    bgElevated: const Color(0xFF070F0A),
    card: const Color(0xFF0A140E),
    surf: const Color(0xFF111C15),
    surfHover: const Color(0xFF17261C),
    border: const Color(0xFF1B2A20),
    borderStrong: const Color(0xFF2B4234),
    primary: const Color(0xFF2BD96B),
    primaryText: const Color(0xFF5CE88C),
    t1: const Color(0xFFEAF2EC),
    t2: const Color(0xFF84968B),
    t3: const Color(0xFF4B5E52),
  ),
  AppPalette.grafite: _mk(
    dark: true,
    bg: const Color(0xFF0A0A0B),
    bgElevated: const Color(0xFF0F0F11),
    card: const Color(0xFF141416),
    surf: const Color(0xFF1B1B1E),
    surfHover: const Color(0xFF232327),
    border: const Color(0xFF242428),
    borderStrong: const Color(0xFF35353B),
    primary: const Color(0xFFE0A33A),
    primaryText: const Color(0xFFF0C476),
    t1: const Color(0xFFF2F2F3),
    t2: const Color(0xFF9A9AA2),
    t3: const Color(0xFF5C5C64),
  ),
  AppPalette.indigo: _mk(
    dark: true,
    bg: const Color(0xFF07080F),
    bgElevated: const Color(0xFF0B0D18),
    card: const Color(0xFF10131F),
    surf: const Color(0xFF171B2B),
    surfHover: const Color(0xFF1F2437),
    border: const Color(0xFF20263A),
    borderStrong: const Color(0xFF323A55),
    primary: const Color(0xFF7C8CFF),
    primaryText: const Color(0xFF9EAAFF),
    t1: const Color(0xFFEDEEF6),
    t2: const Color(0xFF8B91AC),
    t3: const Color(0xFF525873),
  ),
  AppPalette.ardosia: _mk(
    dark: true,
    bg: const Color(0xFF080B0D),
    bgElevated: const Color(0xFF0C1114),
    card: const Color(0xFF11171B),
    surf: const Color(0xFF182026),
    surfHover: const Color(0xFF202A31),
    border: const Color(0xFF212B32),
    borderStrong: const Color(0xFF33414A),
    primary: const Color(0xFF3FC7D4),
    primaryText: const Color(0xFF6FDCE6),
    t1: const Color(0xFFE9EFF2),
    t2: const Color(0xFF8695A0),
    t3: const Color(0xFF4E5C66),
  ),
  AppPalette.vinho: _mk(
    dark: true,
    bg: const Color(0xFF0C0709),
    bgElevated: const Color(0xFF120B0E),
    card: const Color(0xFF181013),
    surf: const Color(0xFF211619),
    surfHover: const Color(0xFF2A1D21),
    border: const Color(0xFF2A1D21),
    borderStrong: const Color(0xFF3E2B31),
    primary: const Color(0xFFE0708A),
    primaryText: const Color(0xFFF093A8),
    t1: const Color(0xFFF3EBED),
    t2: const Color(0xFFA08D93),
    t3: const Color(0xFF64545A),
  ),
};

final Map<AppPalette, AppColors> _light = {
  AppPalette.convexa: _mk(
    dark: false,
    bg: const Color(0xFFF5F8F6),
    bgElevated: const Color(0xFFFFFFFF),
    card: const Color(0xFFFFFFFF),
    surf: const Color(0xFFEFF4F1),
    surfHover: const Color(0xFFE4ECE7),
    border: const Color(0xFFDFE7E2),
    borderStrong: const Color(0xFFC4D2C9),
    primary: const Color(0xFF12833F),
    primaryText: const Color(0xFF0D6B33),
    t1: const Color(0xFF0F1712),
    t2: const Color(0xFF57665C),
    t3: const Color(0xFF95A69B),
  ),
  AppPalette.grafite: _mk(
    dark: false,
    bg: const Color(0xFFF7F7F8),
    bgElevated: const Color(0xFFFFFFFF),
    card: const Color(0xFFFFFFFF),
    surf: const Color(0xFFF1F1F3),
    surfHover: const Color(0xFFE7E7EA),
    border: const Color(0xFFE3E3E6),
    borderStrong: const Color(0xFFCACACF),
    primary: const Color(0xFF8A5A08),
    primaryText: const Color(0xFF6F4806),
    t1: const Color(0xFF161618),
    t2: const Color(0xFF5F5F66),
    t3: const Color(0xFF9C9CA4),
  ),
  AppPalette.indigo: _mk(
    dark: false,
    bg: const Color(0xFFF6F7FB),
    bgElevated: const Color(0xFFFFFFFF),
    card: const Color(0xFFFFFFFF),
    surf: const Color(0xFFEFF1F8),
    surfHover: const Color(0xFFE4E7F3),
    border: const Color(0xFFE0E4F0),
    borderStrong: const Color(0xFFC5CBE0),
    primary: const Color(0xFF3B45B8),
    primaryText: const Color(0xFF2F3796),
    t1: const Color(0xFF121424),
    t2: const Color(0xFF5A6079),
    t3: const Color(0xFF9AA0B8),
  ),
  AppPalette.ardosia: _mk(
    dark: false,
    bg: const Color(0xFFF5F8F9),
    bgElevated: const Color(0xFFFFFFFF),
    card: const Color(0xFFFFFFFF),
    surf: const Color(0xFFEDF2F4),
    surfHover: const Color(0xFFE2E9EC),
    border: const Color(0xFFDEE6E9),
    borderStrong: const Color(0xFFC1CDD3),
    primary: const Color(0xFF11707C),
    primaryText: const Color(0xFF0C5A64),
    t1: const Color(0xFF0F171A),
    t2: const Color(0xFF556168),
    t3: const Color(0xFF93A1A9),
  ),
  AppPalette.vinho: _mk(
    dark: false,
    bg: const Color(0xFFFAF6F7),
    bgElevated: const Color(0xFFFFFFFF),
    card: const Color(0xFFFFFFFF),
    surf: const Color(0xFFF4EDEF),
    surfHover: const Color(0xFFEBE1E4),
    border: const Color(0xFFEBE0E3),
    borderStrong: const Color(0xFFD6C2C8),
    primary: const Color(0xFFA8324F),
    primaryText: const Color(0xFF8B2440),
    t1: const Color(0xFF1A1214),
    t2: const Color(0xFF6B575D),
    t3: const Color(0xFFA9959B),
  ),
};
