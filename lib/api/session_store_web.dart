// `dart:html` está marcado como legado nas versões novas do SDK, mas é o único
// caminho para o `localStorage` sem adicionar dependência ao projeto (que hoje
// só usa `http` e `google_fonts`). Fica isolado neste arquivo, carregado só no
// build web.
// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:html' as html;

import 'session_store.dart';

/// "Continuar conectado" no Flutter Web: o access token (15 min) e o refresh
/// token (30 dias) ficam no `localStorage`. Ao reabrir o painel o app tenta
/// `GET /api/auth/me`; se o access expirou, o `ApiClient` troca pelo refresh
/// automaticamente.
class SessionStoreImpl implements SessionStore {
  static const _accessKey = 'convexa.session.accessToken';
  static const _refreshKey = 'convexa.session.refreshToken';

  html.Storage get _ls => html.window.localStorage;

  @override
  String? get accessToken => _read(_accessKey);

  @override
  String? get refreshToken => _read(_refreshKey);

  @override
  bool get hasSession {
    final rt = refreshToken;
    return rt != null && rt.isNotEmpty;
  }

  String? _read(String key) {
    try {
      final value = _ls[key];
      return (value == null || value.isEmpty) ? null : value;
    } catch (_) {
      // Aba anônima ou storage bloqueado: age como se não houvesse sessão.
      return null;
    }
  }

  @override
  void save({required String accessToken, required String refreshToken}) {
    try {
      _ls[_accessKey] = accessToken;
      _ls[_refreshKey] = refreshToken;
    } catch (_) {}
  }

  @override
  void updateAccessToken(String accessToken) {
    try {
      _ls[_accessKey] = accessToken;
    } catch (_) {}
  }

  @override
  void clear() {
    try {
      _ls.remove(_accessKey);
      _ls.remove(_refreshKey);
    } catch (_) {}
  }
}
