// Mesmo motivo do prefs_web.dart: sem dependência nova só para abrir um link.
// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:html' as html;

void openExternal(String url) {
  try {
    html.window.open(url, '_blank', 'noopener');
  } catch (_) {}
}
