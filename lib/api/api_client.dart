import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'session_store.dart';

// ===========================================================================
// PONTO DE LIGAÇÃO COM A API — leia antes de mexer.
//
// Base URL da API publicada (Dokploy/Traefik):
//     https://api-convexa.altvia.cloud
//
// Para apontar o painel para outro ambiente, passe em tempo de build:
//     flutter run   -d chrome --dart-define=API_BASE_URL=http://localhost:3000
//     flutter build web --release --dart-define=API_BASE_URL=https://api-convexa.altvia.cloud
//
// Autenticação: POST /api/auth/login devolve um JWT. Todas as demais rotas
// exigem o header `Authorization: Bearer <token>`. O businessId é derivado
// do próprio token no servidor — o painel NÃO envia x-business-id.
//
// NUNCA colocar chave da OpenAI, token da Meta/WhatsApp ou secret de
// pagamento neste arquivo. O painel só conversa com a nossa própria API.
// ===========================================================================

class ApiException implements Exception {
  final int statusCode;
  final String message;
  final String? code;

  const ApiException(this.statusCode, this.message, {this.code});

  bool get isUnauthorized => statusCode == 401 || statusCode == 403;
  bool get isNotFound => statusCode == 404;

  @override
  String toString() => 'ApiException($statusCode): $message';
}

class ApiClient {
  static const String defaultBaseUrl = 'https://api-convexa.altvia.cloud';

  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: defaultBaseUrl,
  );

  /// Serviço de automação (bot do WhatsApp, Pix, Google Agenda, Alexa).
  /// Usa a mesma sessão do painel: o token da ConvexaAPI vale lá também.
  static const String automationBaseUrl = String.fromEnvironment(
    'AUTOMACAO_URL',
    defaultValue: 'https://automacao-convexa.altvia.cloud',
  );

  /// Endereço público do webhook do WhatsApp (n8n), mostrado ao dono para
  /// colar no painel da Meta. Vazio: a tela orienta a pedir ao suporte.
  static const String whatsappWebhookUrl = String.fromEnvironment('WHATSAPP_WEBHOOK_URL');

  static const Duration timeout = Duration(seconds: 12);

  final http.Client _http;
  final SessionStore _store;
  String? _token;
  String? _refreshToken;
  Future<bool>? _refreshInFlight;

  ApiClient({http.Client? httpClient, SessionStore? store})
      : _http = httpClient ?? http.Client(),
        _store = store ?? SessionStore() {
    _token = _store.accessToken;
    _refreshToken = _store.refreshToken;
  }

  bool get hasToken => _token != null && _token!.isNotEmpty;
  bool get hasStoredSession =>
      _refreshToken != null && _refreshToken!.isNotEmpty;
  String? get token => _token;
  String? get refreshTokenValue => _refreshToken;

  /// Só o access token, sem persistir — usado em testes e fluxos curtos.
  void setToken(String? value) => _token = value;

  /// Guarda a sessão inteira. `persist: true` grava no `localStorage` (web)
  /// para o "continuar conectado"; `false` mantém só em memória.
  void setSession(String accessToken, String refreshToken,
      {bool persist = true}) {
    _token = accessToken.isEmpty ? null : accessToken;
    _refreshToken = refreshToken.isEmpty ? null : refreshToken;
    if (persist && _token != null && _refreshToken != null) {
      _store.save(accessToken: accessToken, refreshToken: refreshToken);
    } else {
      _store.clear();
    }
  }

  void clearToken() => clearSession();

  void clearSession() {
    _token = null;
    _refreshToken = null;
    _refreshInFlight = null;
    _store.clear();
  }

  Map<String, String> _headers({bool json = true}) => {
        if (json) 'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (hasToken) 'Authorization': 'Bearer $_token',
      };

  Uri _uri(String path, [Map<String, dynamic>? query]) {
    // Rotas "auto:/v1/..." vão para o serviço de automação
    final isAuto = path.startsWith('auto:');
    final rest = isAuto ? path.substring(5) : path;
    final normalized = rest.startsWith('/') ? rest : '/$rest';
    final base = isAuto ? automationBaseUrl : baseUrl;
    final cleanQuery = query?.entries
        .where((e) => e.value != null)
        .map((e) => MapEntry(e.key, e.value.toString()));
    return Uri.parse('$base$normalized').replace(
      queryParameters:
          cleanQuery == null || cleanQuery.isEmpty ? null : Map.fromEntries(cleanQuery),
    );
  }

  Future<dynamic> get(String path,
          {Map<String, dynamic>? query, bool allowRefresh = true}) =>
      _send(() => _http.get(_uri(path, query), headers: _headers(json: false)),
          allowRefresh: allowRefresh);

  Future<dynamic> post(String path, {Object? body, bool allowRefresh = true}) =>
      _send(
          () => _http.post(_uri(path),
              headers: _headers(), body: jsonEncode(body)),
          allowRefresh: allowRefresh);

  Future<dynamic> patch(String path, {Object? body, bool allowRefresh = true}) =>
      _send(
          () => _http.patch(_uri(path),
              headers: _headers(), body: jsonEncode(body)),
          allowRefresh: allowRefresh);

  Future<dynamic> put(String path, {Object? body, bool allowRefresh = true}) =>
      _send(
          () => _http.put(_uri(path),
              headers: _headers(), body: jsonEncode(body)),
          allowRefresh: allowRefresh);

  Future<dynamic> delete(String path, {bool allowRefresh = true}) => _send(
      () => _http.delete(_uri(path), headers: _headers(json: false)),
      allowRefresh: allowRefresh);

  Future<dynamic> _send(Future<http.Response> Function() request,
      {bool allowRefresh = true}) async {
    late http.Response response;
    try {
      response = await request().timeout(timeout);
    } on TimeoutException {
      throw const ApiException(408, 'A API demorou demais para responder.');
    } catch (_) {
      throw const ApiException(0, 'Não foi possível falar com o servidor.');
    }

    // Access token dura 15 min. Ao tomar 401, troca pelo refresh token uma vez
    // e repete a requisição — é o que mantém o painel logado sem pedir a senha.
    if (response.statusCode == 401 &&
        allowRefresh &&
        hasStoredSession &&
        await _ensureRefreshed()) {
      try {
        response = await request().timeout(timeout);
      } on TimeoutException {
        throw const ApiException(408, 'A API demorou demais para responder.');
      } catch (_) {
        throw const ApiException(0, 'Não foi possível falar com o servidor.');
      }
    }

    final hasBody = response.body.isNotEmpty;
    dynamic decoded;
    if (hasBody) {
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = null;
      }
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }

    final map = decoded is Map<String, dynamic> ? decoded : const {};
    final code = map['code']?.toString();
    throw ApiException(
      response.statusCode,
      _messageFor(code) ??
          (map['message'] ?? _defaultMessage(response.statusCode)).toString(),
      code: code,
    );
  }

  /// A API **rotaciona** o refresh token a cada uso e derruba a sessão inteira
  /// se um token já revogado voltar. O `_refreshInFlight` garante uma troca por
  /// vez mesmo quando várias chamadas tomam 401 juntas.
  Future<bool> _ensureRefreshed() => _refreshInFlight ??=
      _doRefresh().whenComplete(() => _refreshInFlight = null);

  Future<bool> _doRefresh() async {
    final rt = _refreshToken;
    if (rt == null || rt.isEmpty) return false;

    late http.Response res;
    try {
      res = await _http
          .post(_uri('/api/auth/refresh'),
              headers: _headers(), body: jsonEncode({'refreshToken': rt}))
          .timeout(timeout);
    } catch (_) {
      return false;
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      if (res.statusCode == 401) clearSession();
      return false;
    }

    Map<String, dynamic> body;
    try {
      final decoded = jsonDecode(res.body);
      body = decoded is Map<String, dynamic> ? decoded : const {};
      final inner = body['data'];
      if (inner is Map<String, dynamic>) body = inner;
    } catch (_) {
      return false;
    }

    final access = (body['accessToken'] ?? body['token'] ?? '').toString();
    final refresh = (body['refreshToken'] ?? '').toString();
    if (access.isEmpty) return false;

    _token = access;
    if (refresh.isNotEmpty) _refreshToken = refresh;
    // Só re-persiste se a sessão já estava persistida (checkbox marcado).
    if (_store.hasSession || _store.accessToken != null) {
      _store.save(accessToken: _token!, refreshToken: _refreshToken!);
    }
    return true;
  }

  /// A API garante que `code` é estável entre versões, enquanto `message` é
  /// texto para humano e pode mudar. Então a decisão é sempre pelo código —
  /// o texto abaixo é nosso, escrito para quem opera o painel.
  static String? _messageFor(String? code) => switch (code) {
        'PAST' => 'Esse horário já passou.',
        'CLOSED_DAY' => 'O estabelecimento não atende nesta data.',
        'BUSINESS_VACATION' => 'O estabelecimento está de férias nesta data.',
        'EMPLOYEE_VACATION' => 'O profissional está de férias nesta data.',
        'OUTSIDE_BUSINESS_HOURS' =>
          'Fora do horário de funcionamento configurado.',
        'OUTSIDE_EMPLOYEE_HOURS' => 'Fora da jornada desse profissional.',
        'TIME_BLOCK' => 'Existe um bloqueio na agenda nesse horário.',
        'APPOINTMENT_CONFLICT' => 'Já existe um agendamento nesse horário.',
        'SLOT_CONFLICT' =>
          'Esse horário acabou de ser ocupado. Escolha outro.',
        'UNIQUE_VIOLATION' => 'Já existe um registro com esse dado.',
        'FOREIGN_KEY_VIOLATION' =>
          'Não dá para excluir: existem registros ligados a este.',
        'NOT_FOUND' => 'Registro não encontrado.',
        'INVALID_ID' => 'Identificador inválido.',
        'INTERNAL_ERROR' =>
          'Erro inesperado no servidor. Avise o time do backend.',
        _ => null,
      };

  String _defaultMessage(int status) => switch (status) {
        400 => 'Dados inválidos.',
        401 => 'Sessão expirada. Entre novamente.',
        403 => 'Você não tem permissão para esta ação.',
        404 => 'Recurso não encontrado.',
        409 => 'Conflito com um registro existente.',
        429 => 'Muitas tentativas. Aguarde um instante.',
        _ => 'Erro inesperado no servidor.',
      };

  void dispose() => _http.close();
}
