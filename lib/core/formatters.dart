String _pad2(int n) => n.toString().padLeft(2, '0');

String formatCurrency(int cents, {bool showSymbol = true}) {
  final negative = cents < 0;
  final abs = cents.abs();
  final reais = abs ~/ 100;
  final decimals = abs % 100;
  final buffer = StringBuffer();
  final digits = reais.toString();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('.');
    buffer.write(digits[i]);
  }
  final symbol = showSymbol ? r'R$ ' : '';
  return '${negative ? '-' : ''}$symbol$buffer,${_pad2(decimals)}';
}

String formatCurrencyCompact(int cents) {
  final reais = cents / 100;
  if (reais >= 1000) {
    final thousands = reais / 1000;
    final text = thousands.toStringAsFixed(thousands >= 10 ? 0 : 1);
    return 'R\$ ${text.replaceAll('.', ',')}k';
  }
  return formatCurrency(cents);
}

String formatMinutesAsClock(int minutes) {
  // 1440 é meia-noite do dia seguinte e precisa aparecer como 24:00. Com
  // `% 1440` ele virava 00:00, e a janela "09:00 às 24:00" era exibida como
  // "09:00 às 00:00", parecendo dia zerado.
  if (minutes >= 24 * 60) {
    final hours = minutes ~/ 60;
    return '${_pad2(hours)}:${_pad2(minutes % 60)}';
  }
  final safe = minutes < 0 ? 0 : minutes;
  return '${_pad2(safe ~/ 60)}:${_pad2(safe % 60)}';
}

String formatDuration(int minutes) {
  if (minutes < 60) return '${minutes}min';
  final hours = minutes ~/ 60;
  final rest = minutes % 60;
  if (rest == 0) return '${hours}h';
  return '${hours}h${_pad2(rest)}';
}

String formatTimeOfDay(DateTime date) =>
    '${_pad2(date.hour)}:${_pad2(date.minute)}';

String formatPhone(String raw) {
  final digits = raw.replaceAll(RegExp(r'\D'), '');
  if (digits.length == 13 && digits.startsWith('55')) {
    return '+55 (${digits.substring(2, 4)}) ${digits.substring(4, 9)}-${digits.substring(9)}';
  }
  if (digits.length == 11) {
    return '(${digits.substring(0, 2)}) ${digits.substring(2, 7)}-${digits.substring(7)}';
  }
  if (digits.length == 10) {
    return '(${digits.substring(0, 2)}) ${digits.substring(2, 6)}-${digits.substring(6)}';
  }
  return raw;
}

int? parseCurrencyToCents(String input) {
  final cleaned = input.replaceAll(RegExp(r'[^\d,.]'), '').trim();
  if (cleaned.isEmpty) return null;
  final normalized = cleaned.contains(',')
      ? cleaned.replaceAll('.', '').replaceAll(',', '.')
      : cleaned;
  final value = double.tryParse(normalized);
  if (value == null) return null;
  return (value * 100).round();
}

String initialsOf(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
  return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
      .toUpperCase();
}
