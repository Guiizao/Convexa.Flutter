import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

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

  static const Duration timeout = Duration(seconds: 12);

  final http.Client _http;
  String? _token;

  ApiClient({http.Client? httpClient}) : _http = httpClient ?? http.Client();

  bool get hasToken => _token != null && _token!.isNotEmpty;
  String? get token => _token;

  void setToken(String? value) => _token = value;
  void clearToken() => _token = null;

  Map<String, String> _headers({bool json = true}) => {
        if (json) 'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (hasToken) 'Authorization': 'Bearer $_token',
      };

  Uri _uri(String path, [Map<String, dynamic>? query]) {
    final normalized = path.startsWith('/') ? path : '/$path';
    final cleanQuery = query?.entries
        .where((e) => e.value != null)
        .map((e) => MapEntry(e.key, e.value.toString()));
    return Uri.parse('$baseUrl$normalized').replace(
      queryParameters:
          cleanQuery == null || cleanQuery.isEmpty ? null : Map.fromEntries(cleanQuery),
    );
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) =>
      _send(() => _http.get(_uri(path, query), headers: _headers(json: false)));

  Future<dynamic> post(String path, {Object? body}) => _send(
      () => _http.post(_uri(path), headers: _headers(), body: jsonEncode(body)));

  Future<dynamic> patch(String path, {Object? body}) => _send(() =>
      _http.patch(_uri(path), headers: _headers(), body: jsonEncode(body)));

  Future<dynamic> put(String path, {Object? body}) => _send(
      () => _http.put(_uri(path), headers: _headers(), body: jsonEncode(body)));

  Future<dynamic> delete(String path) =>
      _send(() => _http.delete(_uri(path), headers: _headers(json: false)));

  Future<dynamic> _send(Future<http.Response> Function() request) async {
    late final http.Response response;
    try {
      response = await request().timeout(timeout);
    } on TimeoutException {
      throw const ApiException(408, 'A API demorou demais para responder.');
    } catch (_) {
      throw const ApiException(0, 'Não foi possível falar com o servidor.');
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
    throw ApiException(
      response.statusCode,
      (map['message'] ?? _defaultMessage(response.statusCode)).toString(),
      code: map['code']?.toString(),
    );
  }

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
