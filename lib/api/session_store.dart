import 'session_store_io.dart'
    if (dart.library.html) 'session_store_web.dart';

/// Guarda os tokens da sessão entre recarregamentos da página.
///
/// No Flutter Web usa `window.localStorage`; fora do web (os testes rodam na
/// VM) não persiste nada — a sessão vive só em memória, como antes.
abstract class SessionStore {
  factory SessionStore() = SessionStoreImpl;

  String? get accessToken;
  String? get refreshToken;

  void save({required String accessToken, required String refreshToken});
  void updateAccessToken(String accessToken);
  void clear();

  bool get hasSession {
    final rt = refreshToken;
    return rt != null && rt.isNotEmpty;
  }
}
