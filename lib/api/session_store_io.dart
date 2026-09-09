import 'session_store.dart';

/// Fora do Flutter Web (VM, testes) não há `localStorage`. A sessão continua
/// valendo enquanto o app estiver aberto, mas não sobrevive a um restart.
class SessionStoreImpl implements SessionStore {
  String? _access;
  String? _refresh;

  @override
  String? get accessToken => _access;

  @override
  String? get refreshToken => _refresh;

  @override
  bool get hasSession => _refresh != null && _refresh!.isNotEmpty;

  @override
  void save({required String accessToken, required String refreshToken}) {
    _access = accessToken;
    _refresh = refreshToken;
  }

  @override
  void updateAccessToken(String accessToken) => _access = accessToken;

  @override
  void clear() {
    _access = null;
    _refresh = null;
  }
}
