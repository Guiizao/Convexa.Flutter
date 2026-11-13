// Mesmo motivo do session_store_web.dart: localStorage sem dependência nova.
// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:html' as html;

import 'prefs.dart';

class PrefsImpl implements Prefs {
  @override
  String? read(String key) {
    try {
      return html.window.localStorage['convexa.pref.$key'];
    } catch (_) {
      return null;
    }
  }

  @override
  void write(String key, String value) {
    try {
      html.window.localStorage['convexa.pref.$key'] = value;
    } catch (_) {}
  }
}
