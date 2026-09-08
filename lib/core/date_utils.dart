const _weekdays = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];

const _weekdaysShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const _months = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const _monthsShort = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

String _pad2(int n) => n.toString().padLeft(2, '0');

String weekdayName(DateTime d) => _weekdays[d.weekday % 7];
String weekdayShort(DateTime d) => _weekdaysShort[d.weekday % 7];
String monthName(DateTime d) => _months[d.month - 1];
String monthShort(DateTime d) => _monthsShort[d.month - 1];

String fullDateLabel(DateTime d) =>
    '${weekdayName(d)}, ${d.day} de ${monthName(d)} de ${d.year}';

String mediumDateLabel(DateTime d) =>
    '${weekdayShort(d)}, ${d.day} de ${monthName(d)}';

String shortDayMonth(DateTime d) => '${_pad2(d.day)}/${_pad2(d.month)}';

String dayMonthLabel(DateTime d) => '${d.day} de ${monthName(d)}';

String monthYearLabel(DateTime d) {
  final m = monthName(d);
  return '${m[0].toUpperCase()}${m.substring(1)} de ${d.year}';
}

String greetingForHour(int hour) {
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

String relativeDayLabel(DateTime date, DateTime reference) {
  final d = DateTime(date.year, date.month, date.day);
  final r = DateTime(reference.year, reference.month, reference.day);
  final diff = d.difference(r).inDays;
  return switch (diff) {
    0 => 'Hoje',
    1 => 'Amanhã',
    -1 => 'Ontem',
    _ => mediumDateLabel(date),
  };
}

bool isSameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

List<DateTime?> monthGrid(DateTime month) {
  final first = DateTime(month.year, month.month, 1);
  final daysInMonth = DateTime(month.year, month.month + 1, 0).day;
  final leading = first.weekday % 7;
  final cells = <DateTime?>[];
  for (var i = 0; i < leading; i++) {
    cells.add(null);
  }
  for (var d = 1; d <= daysInMonth; d++) {
    cells.add(DateTime(month.year, month.month, d));
  }
  while (cells.length % 7 != 0) {
    cells.add(null);
  }
  return cells;
}
