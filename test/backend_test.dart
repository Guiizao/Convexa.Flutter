import 'dart:convert';

import 'package:convexa/api/api_client.dart';
import 'package:convexa/api/repositories.dart';
import 'package:convexa/core/formatters.dart';
import 'package:convexa/models/models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

ApiClient clientReturning(
  Object body, {
  int status = 200,
  void Function(http.Request)? onRequest,
}) {
  return ApiClient(
    httpClient: MockClient((request) async {
      onRequest?.call(request);
      return http.Response(jsonEncode(body), status,
          headers: {'content-type': 'application/json'});
    }),
  );
}

void main() {
  group('formatters', () {
    test('formata centavos em reais no padrão brasileiro', () {
      expect(formatCurrency(0), r'R$ 0,00');
      expect(formatCurrency(4000), r'R$ 40,00');
      expect(formatCurrency(123456), r'R$ 1.234,56');
      expect(formatCurrency(-2550), r'-R$ 25,50');
    });

    test('converte texto digitado em centavos', () {
      expect(parseCurrencyToCents('40'), 4000);
      expect(parseCurrencyToCents('40,50'), 4050);
      expect(parseCurrencyToCents('1.234,56'), 123456);
      expect(parseCurrencyToCents('abc'), isNull);
    });

    test('formata minutos como relógio e duração', () {
      expect(formatMinutesAsClock(9 * 60), '09:00');
      expect(formatMinutesAsClock(19 * 60 + 30), '19:30');
      expect(formatDuration(45), '45min');
      expect(formatDuration(90), '1h30');
      expect(formatDuration(120), '2h');
    });
  });

  group('AuthRepository', () {
    test('guarda o token devolvido pelo login', () async {
      final api = clientReturning({
        'token': 'jwt-de-teste',
        'user': {'name': 'Ana', 'email': 'ana@convexa.app'},
        'business': {'id': 'biz-1', 'name': 'Barbearia Central'},
      });
      final repo = AuthRepository(RepositoryContext(api: api));

      final session = await repo.signIn('ana@convexa.app', 'senha');

      expect(session.token, 'jwt-de-teste');
      expect(session.businessName, 'Barbearia Central');
      expect(api.hasToken, isTrue);
    });

    test('rejeita resposta sem token em vez de fingir sucesso', () async {
      final api = clientReturning({'user': {'name': 'Ana'}});
      final repo = AuthRepository(RepositoryContext(api: api));

      await expectLater(
        repo.signIn('ana@convexa.app', 'senha'),
        throwsA(isA<ApiException>()),
      );
      expect(api.hasToken, isFalse);
    });

    test('propaga a mensagem de erro da API em credencial inválida', () async {
      final api = clientReturning(
        {'status': 'error', 'message': 'E-mail ou senha inválidos'},
        status: 401,
      );
      final repo = AuthRepository(RepositoryContext(api: api));

      await expectLater(
        repo.signIn('x@y.com', 'errada'),
        throwsA(isA<ApiException>()
            .having((e) => e.message, 'message', 'E-mail ou senha inválidos')
            .having((e) => e.isUnauthorized, 'isUnauthorized', isTrue)),
      );
    });

    test('signOut limpa o token guardado', () async {
      final api = clientReturning({
        'token': 'jwt',
        'business': {'id': 'b'},
      });
      final repo = AuthRepository(RepositoryContext(api: api));
      await repo.signIn('a@b.com', 'x');
      expect(api.hasToken, isTrue);

      repo.signOut();

      expect(api.hasToken, isFalse);
    });
  });

  group('ApiClient', () {
    test('envia Authorization Bearer depois de autenticar', () async {
      String? authHeader;
      final api = clientReturning(
        {'token': 'jwt-123', 'business': {'id': 'b'}},
        onRequest: (r) => authHeader = r.headers['Authorization'],
      );
      api.setToken('jwt-123');

      await api.get('/api/services');

      expect(authHeader, 'Bearer jwt-123');
    });

    test('nao envia Authorization sem token', () async {
      String? authHeader;
      final api = clientReturning(
        [],
        onRequest: (r) => authHeader = r.headers['Authorization'],
      );

      await api.get('/api/services');

      expect(authHeader, isNull);
    });

    test('usa a API publicada como base padrao', () {
      expect(ApiClient.baseUrl, 'https://api-convexa.altvia.cloud');
    });

    test('troca o refresh token e repete a requisicao ao tomar 401', () async {
      var meCalls = 0;
      var refreshCalls = 0;
      final api = ApiClient(
        httpClient: MockClient((request) async {
          final path = request.url.path;
          if (path == '/api/auth/refresh') {
            refreshCalls++;
            expect(jsonDecode(request.body),
                {'refreshToken': 'refresh-velho'});
            return http.Response(
              jsonEncode(
                  {'accessToken': 'access-novo', 'refreshToken': 'refresh-novo'}),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (path == '/api/auth/me') {
            meCalls++;
            if (meCalls == 1) {
              return http.Response(jsonEncode({'message': 'expirado'}), 401,
                  headers: {'content-type': 'application/json'});
            }
            expect(request.headers['Authorization'], 'Bearer access-novo');
            return http.Response(
              jsonEncode({
                'user': {'name': 'Ana'},
                'business': {'id': 'b1', 'name': 'Central'},
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          return http.Response('{}', 404);
        }),
      );
      api.setSession('access-velho', 'refresh-velho');

      final data = await api.get('/api/auth/me');

      expect(refreshCalls, 1);
      expect(meCalls, 2);
      expect((data as Map)['business']['name'], 'Central');
      expect(api.token, 'access-novo');
      expect(api.refreshTokenValue, 'refresh-novo');
    });

    test('nao tenta refresh quando allowRefresh e false', () async {
      var refreshCalls = 0;
      final api = ApiClient(
        httpClient: MockClient((request) async {
          if (request.url.path == '/api/auth/refresh') {
            refreshCalls++;
            return http.Response('{}', 200);
          }
          return http.Response(jsonEncode({'message': 'nao'}), 401,
              headers: {'content-type': 'application/json'});
        }),
      );
      api.setSession('a', 'r');

      await expectLater(
        api.post('/api/auth/login', body: {}, allowRefresh: false),
        throwsA(isA<ApiException>()
            .having((e) => e.statusCode, 'status', 401)),
      );
      expect(refreshCalls, 0);
    });
  });

  group('ServiceRepository', () {
    test('le a lista de servicos da API', () async {
      final api = clientReturning([
        {
          'id': 's1',
          'name': 'Corte',
          'durationMinutes': 30,
          'priceCents': 4000,
          'active': true,
        }
      ]);
      final repo = ServiceRepository(RepositoryContext(api: api));

      final services = await repo.list();

      expect(services, hasLength(1));
      expect(services.first.name, 'Corte');
      expect(services.first.priceCents, 4000);
    });

    test('aceita resposta encapsulada em data', () async {
      final api = clientReturning({
        'data': [
          {'id': 's1', 'name': 'Barba', 'durationMinutes': 20, 'priceCents': 2500}
        ]
      });
      final repo = ServiceRepository(RepositoryContext(api: api));

      final services = await repo.list();

      expect(services.single.name, 'Barba');
    });
  });

  group('Appointment', () {
    test('monta o agendamento a partir do formato da API', () {
      final appointment = Appointment.fromJson({
        'id': 'a1',
        'startAt': '2026-09-08T14:30:00.000Z',
        'durationMinutes': 50,
        'priceCents': 6000,
        'status': 'CONFIRMED',
        'channel': 'WHATSAPP',
        'customer': {'name': 'Daniel Morais', 'phone': '5511970000001'},
        'service': {'name': 'Corte + barba'},
      });

      expect(appointment.customerName, 'Daniel Morais');
      expect(appointment.serviceName, 'Corte + barba');
      expect(appointment.status, AppointmentStatus.confirmed);
      expect(appointment.channel, BookingChannel.whatsapp);
      expect(
        appointment.endAt.difference(appointment.startAt).inMinutes,
        50,
      );
    });

    test('cai para SCHEDULED quando o status vem desconhecido', () {
      final appointment = Appointment.fromJson({
        'id': 'a2',
        'startAt': '2026-09-08T10:00:00.000Z',
        'status': 'ALGO_NOVO',
      });

      expect(appointment.status, AppointmentStatus.scheduled);
    });
  });

  group('WorkShift', () {
    test('comeca fechado com janela padrao', () {
      final shift = WorkShift.initial(DateTime(2026, 9, 8));

      expect(shift.state, ShiftState.closed);
      expect(shift.isOpen, isFalse);
      expect(shift.hours.startMinutes, 9 * 60);
      expect(shift.hours.endMinutes, 19 * 60);
      expect(shift.hours.isValid, isTrue);
    });

    test('janela invertida e invalida', () {
      const range = TimeRange(19 * 60, 9 * 60);
      expect(range.isValid, isFalse);
    });
  });

  group('AgentSettings', () {
    test('ida e volta pelo JSON preserva as regras do agente', () {
      const settings = AgentSettings(
        prepaymentEnabled: true,
        prepaymentDiscountPercent: 15,
        upsellEnabled: true,
        upsellServiceIds: ['s1', 's2'],
        reminderMinutesBefore: 90,
        googleCalendarSync: true,
      );

      final restored = AgentSettings.fromJson(settings.toJson());

      expect(restored.prepaymentEnabled, isTrue);
      expect(restored.prepaymentDiscountPercent, 15);
      expect(restored.upsellServiceIds, ['s1', 's2']);
      expect(restored.reminderMinutesBefore, 90);
      expect(restored.googleCalendarSync, isTrue);
    });
  });

  group('ScheduleRepository.availability', () {
    test('le os horarios livres do campo slots da API', () async {
      final api = clientReturning({
        'date': '2026-09-10',
        'serviceId': 's1',
        'durationMinutes': 30,
        'totalSlots': 2,
        'slots': [
          {'employeeId': 'e1', 'startAt': '2026-09-10T13:00:00.000Z'},
          {'employeeId': 'e1', 'startAt': '2026-09-10T13:30:00.000Z'},
        ],
      });
      final repo = ScheduleRepository(RepositoryContext(api: api));

      final slots = await repo.availability(DateTime(2026, 9, 10), 's1');

      expect(slots, hasLength(2));
      expect(slots.first.toUtc(), DateTime.utc(2026, 9, 10, 13));
    });

    test('devolve vazio quando a resposta nao traz slots', () async {
      final api = clientReturning({'totalSlots': 0});
      final repo = ScheduleRepository(RepositoryContext(api: api));

      expect(await repo.availability(DateTime(2026, 9, 10), 's1'), isEmpty);
    });
  });

  group('AuthRepository sessao', () {
    test('restore reidrata a sessao a partir do refresh token guardado',
        () async {
      final api = ApiClient(
        httpClient: MockClient((request) async {
          expect(request.url.path, '/api/auth/me');
          return http.Response(
            jsonEncode({
              'user': {'name': 'Ana', 'email': 'ana@x.com'},
              'business': {'id': 'b1', 'name': 'Central'},
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
      );
      api.setSession('acc', 'ref');
      final repo = AuthRepository(RepositoryContext(api: api));

      final session = await repo.restore();

      expect(session, isNotNull);
      expect(session!.businessName, 'Central');
      expect(session.token, 'acc');
      expect(session.refreshToken, 'ref');
    });

    test('restore devolve null e limpa a sessao quando o me falha', () async {
      final api = ApiClient(
        httpClient: MockClient((request) async => http.Response(
              jsonEncode({'message': 'x'}),
              401,
              headers: {'content-type': 'application/json'},
            )),
      );
      api.setSession('acc', 'ref');
      final repo = AuthRepository(RepositoryContext(api: api));

      expect(await repo.restore(), isNull);
      expect(api.hasStoredSession, isFalse);
    });

    test('signOutRemote envia o refresh token no corpo do logout', () async {
      Object? sentBody;
      final api = ApiClient(
        httpClient: MockClient((request) async {
          expect(request.url.path, '/api/auth/logout');
          sentBody = jsonDecode(request.body);
          return http.Response('', 204);
        }),
      );
      api.setSession('access-1', 'refresh-1');
      final repo = AuthRepository(RepositoryContext(api: api));

      await repo.signOutRemote();

      expect(sentBody, {'refreshToken': 'refresh-1'});
    });
  });
}
