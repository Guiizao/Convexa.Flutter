import 'dart:convert';

import 'package:convexa/api/api_client.dart';
import 'package:convexa/api/repositories.dart';
import 'package:convexa/api/team.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  group('ShiftRepository.saveDayHours', () {
    test('troca só o dia pedido e mantém o resto da semana', () async {
      Map<String, dynamic>? sent;
      final api = ApiClient(
        httpClient: MockClient((request) async {
          if (request.method == 'GET' && request.url.path == '/api/business') {
            return http.Response(
              jsonEncode({
                'hours': [
                  {'dayOfWeek': 1, 'opensAt': 540, 'closesAt': 1140},
                  {'dayOfWeek': 2, 'opensAt': 540, 'closesAt': 1140},
                  {'dayOfWeek': 6, 'opensAt': 480, 'closesAt': 720},
                ],
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.method == 'PUT' && request.url.path == '/api/business/hours') {
            sent = jsonDecode(request.body) as Map<String, dynamic>;
            return http.Response(jsonEncode(sent!['hours']), 200, headers: {'content-type': 'application/json'});
          }
          return http.Response('{}', 404);
        }),
      );
      await ShiftRepository(RepositoryContext(api: api)).saveDayHours(2, 600, 1200);

      final hours = (sent!['hours'] as List).cast<Map<String, dynamic>>();
      expect(hours, hasLength(3));
      expect(hours.where((h) => h['dayOfWeek'] == 1).single['opensAt'], 540);
      expect(hours.where((h) => h['dayOfWeek'] == 6).single['closesAt'], 720);
      final tuesday = hours.where((h) => h['dayOfWeek'] == 2).single;
      expect(tuesday['opensAt'], 600);
      expect(tuesday['closesAt'], 1200);
    });
  });

  group('TeamRepository', () {
    test('lê a equipe paginada, com serviços e horários', () async {
      final api = ApiClient(
        httpClient: MockClient((request) async {
          expect(request.url.queryParameters['includeInactive'], 'true');
          return http.Response(
            jsonEncode({
              'data': [
                {
                  'id': 'b',
                  'name': 'Pedro',
                  'active': false,
                  'services': [],
                  'hours': [],
                },
                {
                  'id': 'a',
                  'name': 'Lucas',
                  'active': true,
                  'services': [
                    {'serviceId': 's1'},
                  ],
                  'hours': [
                    {'id': 'h', 'dayOfWeek': 1, 'startsAt': 540, 'endsAt': 720},
                  ],
                },
              ],
              'meta': {'page': 1, 'perPage': 100, 'total': 2},
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
      );
      final team = await TeamRepository(RepositoryContext(api: api)).list();
      expect(team.map((m) => m.name), ['Lucas', 'Pedro']); // ativos primeiro
      expect(team.first.serviceIds, ['s1']);
      expect(team.first.hours.single.end, 720);
    });
  });
}
