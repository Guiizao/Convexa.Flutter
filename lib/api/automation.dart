import 'repositories.dart';

/// Configurações e estado do bot, servidos pelo convexa-automacao.
/// Os mapas espelham o JSON do serviço; a tela lê e grava por chave.
class AutomationStatus {
  final Map<String, dynamic> raw;
  const AutomationStatus(this.raw);

  Map<String, dynamic> get settings => _map(raw['settings']);
  Map<String, dynamic> get link => _map(raw['link']);
  Map<String, dynamic> get whatsapp => _map(raw['whatsapp']);
  Map<String, dynamic> get google => _map(raw['google']);
  Map<String, dynamic> get alexa => _map(raw['alexa']);
  Map<String, dynamic> get ai => _map(raw['ai']);
  Map<String, dynamic> get secrets => _map(raw['secrets']);
  List<({String id, String label})> get segments => [
        for (final s in (raw['segments'] as List? ?? const []))
          (id: _map(s)['id'].toString(), label: _map(s)['label'].toString()),
      ];

  bool get linked => link['status'] == 'active';
  bool get linkBroken => link['status'] == 'broken';
  bool get whatsappConfigured => whatsapp['configured'] == true;
  bool get deliveryConfigured => _map(raw['delivery'])['configured'] == true;
  int get pendingPayments => (raw['pendingPayments'] as num?)?.toInt() ?? 0;
}

class PendingPayment {
  final String id;
  final String customerName;
  final String customerPhone;
  final String kind;
  final int amountCents;
  final int discountCents;
  final String status;
  final String service;
  final String date;
  final String time;
  final String? receiptUrl;
  final String? analysis;

  const PendingPayment({
    required this.id,
    required this.customerName,
    required this.customerPhone,
    required this.kind,
    required this.amountCents,
    required this.discountCents,
    required this.status,
    required this.service,
    required this.date,
    required this.time,
    this.receiptUrl,
    this.analysis,
  });

  factory PendingPayment.fromJson(Map<String, dynamic> j) {
    final s = _map(j['summary']);
    return PendingPayment(
      id: j['id'].toString(),
      customerName: (j['customerName'] ?? 'Cliente').toString(),
      customerPhone: (j['customerPhone'] ?? '').toString(),
      kind: (j['kind'] ?? 'deposit').toString(),
      amountCents: (j['amountCents'] as num?)?.toInt() ?? 0,
      discountCents: (j['discountCents'] as num?)?.toInt() ?? 0,
      status: (j['status'] ?? '').toString(),
      service: (s['service'] ?? '').toString(),
      date: (s['date'] ?? '').toString(),
      time: (s['time'] ?? '').toString(),
      receiptUrl: j['receiptUrl']?.toString(),
      analysis: _map(j['receiptAnalysis'])['summary']?.toString(),
    );
  }
}

class ConversationSummary {
  final String phone;
  final String name;
  final String role;
  final DateTime? pausedUntil;
  final String lastBody;
  final DateTime? lastAt;
  final bool windowOpen;

  const ConversationSummary({
    required this.phone,
    required this.name,
    required this.role,
    required this.pausedUntil,
    required this.lastBody,
    required this.lastAt,
    required this.windowOpen,
  });

  bool get paused => pausedUntil != null && pausedUntil!.isAfter(DateTime.now());

  factory ConversationSummary.fromJson(Map<String, dynamic> j) => ConversationSummary(
        phone: j['phone'].toString(),
        name: (j['name'] ?? j['phone']).toString(),
        role: (j['role'] ?? 'customer').toString(),
        pausedUntil: DateTime.tryParse((j['pausedUntil'] ?? '').toString())?.toLocal(),
        lastBody: (j['lastBody'] ?? '').toString(),
        lastAt: DateTime.tryParse((j['lastAt'] ?? '').toString())?.toLocal(),
        windowOpen: j['windowOpen'] == true,
      );
}

class ChatLine {
  final bool fromCustomer;
  final String body;
  final DateTime at;
  const ChatLine(this.fromCustomer, this.body, this.at);
}

class AutomationRepository {
  final RepositoryContext ctx;
  AutomationRepository(this.ctx);

  Future<AutomationStatus> status() async {
    if (ctx.demoMode) return AutomationStatus(_demoStatus());
    return AutomationStatus(_map(await ctx.api.get('auto:/v1/panel/status')));
  }

  Future<Map<String, dynamic>> saveSettings(Map<String, dynamic> patch) async {
    if (ctx.demoMode) {
      _deepMerge(_demo['settings'] as Map<String, dynamic>, patch);
      return _map(_demo['settings']);
    }
    return _map(_map(await ctx.api.put('auto:/v1/panel/settings', body: patch))['settings']);
  }

  Future<void> saveSecrets(Map<String, String> secrets) async {
    if (ctx.demoMode) return;
    await ctx.api.put('auto:/v1/panel/secrets', body: secrets);
  }

  Future<void> link(String email, String password) async {
    if (ctx.demoMode) {
      _map(_demo['link'])['status'] = 'active';
      return;
    }
    await ctx.api.post('auto:/v1/panel/link', body: {'email': email, 'password': password});
  }

  Future<void> unlink() async {
    if (ctx.demoMode) return;
    await ctx.api.delete('auto:/v1/panel/link');
  }

  Future<List<PendingPayment>> payments({String status = 'under_review'}) async {
    if (ctx.demoMode) return _demoPayments.map(PendingPayment.fromJson).toList();
    final data = _map(await ctx.api.get('auto:/v1/panel/payments', query: {'status': status}));
    return [for (final p in (data['data'] as List? ?? const [])) PendingPayment.fromJson(_map(p))];
  }

  Future<void> decidePayment(String id, bool approve) async {
    if (ctx.demoMode) {
      _demoPayments.removeWhere((p) => p['id'] == id);
      return;
    }
    await ctx.api.post('auto:/v1/panel/payments/$id/${approve ? 'approve' : 'reject'}');
  }

  Future<List<ConversationSummary>> conversations() async {
    if (ctx.demoMode) return _demoConversations.map(ConversationSummary.fromJson).toList();
    final data = _map(await ctx.api.get('auto:/v1/panel/conversations'));
    return [for (final c in (data['data'] as List? ?? const [])) ConversationSummary.fromJson(_map(c))];
  }

  Future<List<ChatLine>> history(String phone) async {
    if (ctx.demoMode) {
      final now = DateTime.now();
      return [
        ChatLine(true, 'Oi, tem horário amanhã de tarde?', now.subtract(const Duration(minutes: 9))),
        ChatLine(false, 'Tem sim! Qual serviço você quer?', now.subtract(const Duration(minutes: 9))),
        ChatLine(true, 'Corte. Queria falar com alguém sobre o preço', now.subtract(const Duration(minutes: 7))),
      ];
    }
    final data = _map(await ctx.api.get('auto:/v1/panel/conversations/${Uri.encodeComponent(phone)}'));
    return [
      for (final m in (data['data'] as List? ?? const []))
        ChatLine(
          _map(m)['direction'] == 'in',
          (_map(m)['body'] ?? '').toString(),
          DateTime.tryParse(_map(m)['created_at'].toString())?.toLocal() ?? DateTime.now(),
        ),
    ];
  }

  Future<void> reply(String phone, String text) async {
    if (ctx.demoMode) return;
    await ctx.api.post('auto:/v1/panel/conversations/${Uri.encodeComponent(phone)}/reply', body: {'text': text});
  }

  Future<void> resume(String phone) async {
    if (ctx.demoMode) return;
    await ctx.api.post('auto:/v1/panel/conversations/${Uri.encodeComponent(phone)}/resume');
  }

  Future<int> notice(String date, String message) async {
    if (ctx.demoMode) return 3;
    final data = _map(await ctx.api.post('auto:/v1/panel/notice', body: {'date': date, 'message': message}));
    return (data['sent'] as num?)?.toInt() ?? 0;
  }

  Future<String> alexaCode() async {
    if (ctx.demoMode) return '482913';
    return _map(await ctx.api.post('auto:/v1/panel/alexa/code'))['code'].toString();
  }

  Future<void> alexaUnlink() async {
    if (ctx.demoMode) return;
    await ctx.api.delete('auto:/v1/panel/alexa');
  }

  Future<String?> googleConnectUrl() async {
    if (ctx.demoMode) return null;
    return _map(await ctx.api.get('auto:/v1/panel/google/connect'))['url']?.toString();
  }

  Future<void> googleSync() async {
    if (ctx.demoMode) return;
    await ctx.api.post('auto:/v1/panel/google/sync');
  }

  Future<void> googleDisconnect() async {
    if (ctx.demoMode) return;
    await ctx.api.delete('auto:/v1/panel/google');
  }

  // ------------------------------------------------------------- demonstração
  static final Map<String, dynamic> _demo = _demoStatus();

  static Map<String, dynamic> _demoStatus() => {
        'business': {'name': 'Barbearia Demonstração'},
        'whatsapp': {'phoneNumberId': '100000000000001', 'configured': true},
        'link': {'status': 'active', 'ownerEmail': 'demo@convexa.app'},
        'settings': {
          'agentEnabled': true,
          'ownerPhones': ['+5514999990000'],
          'segment': 'barbearia',
          'greeting': '',
          'address': 'Rua Bahia, 120 - Centro, Marília/SP',
          'mapsUrl': '',
          'paymentMethodsText': 'Pix, cartão e dinheiro',
          'askProfessional': true,
          'ownerEmployeeId': null,
          'reminders': {'enabled': true, 'hoursBefore': [24, 2]},
          'prepayment': {
            'mode': 'optional',
            'depositType': 'percent',
            'depositPercent': 30,
            'depositFixedCents': 2000,
            'fullPaymentDiscountPercent': 10,
            'provider': 'static_pix',
            'pixKey': 'pix@barbearia.com.br',
            'merchantName': 'Barbearia Demo',
            'merchantCity': 'Marilia',
            'expiresMinutes': 30,
          },
          'cancellation': {'minHoursBefore': 2, 'depositRefundable': false},
          'notifyOwner': {'newBooking': true, 'cancellation': true, 'reschedule': true, 'handoff': true},
          'handoffHours': 2,
          'costPercent': 35,
          'dailySummary': {'enabled': true, 'time': '08:00'},
          'google': {'enabled': false, 'importBusy': false},
          'alexa': {'enabled': false},
        },
        'secrets': {'mercadoPagoAccessToken': false, 'mercadoPagoWebhookSecret': false},
        'segments': [
          {'id': 'barbearia', 'label': 'Barbearia'},
          {'id': 'salao', 'label': 'Salão de beleza'},
          {'id': 'estetica', 'label': 'Estética'},
          {'id': 'clinica', 'label': 'Clínica / consultório'},
          {'id': 'manicure', 'label': 'Manicure e pedicure'},
          {'id': 'pet', 'label': 'Pet shop'},
          {'id': 'estudio', 'label': 'Estúdio (tatuagem, cílios, sobrancelha)'},
          {'id': 'academia', 'label': 'Personal / aulas'},
          {'id': 'outro', 'label': 'Outro'},
        ],
        'pendingPayments': 1,
        'google': {'available': true, 'connected': false},
        'alexa': {'linkedDevices': 0},
        'ai': {'enabled': false},
        'delivery': {'configured': true},
      };

  static final List<Map<String, dynamic>> _demoPayments = [
    {
      'id': 'demo-pay-1',
      'customerName': 'Marcos Silva',
      'customerPhone': '+5514977776666',
      'kind': 'deposit',
      'amountCents': 1350,
      'discountCents': 0,
      'status': 'under_review',
      'summary': {'service': 'Corte + barba', 'date': '2026-11-14', 'time': '10:30'},
      'receiptUrl': null,
    },
  ];

  static final List<Map<String, dynamic>> _demoConversations = [
    {
      'phone': '+5514988887777',
      'name': 'Ana Paula',
      'role': 'customer',
      'pausedUntil': DateTime.now().add(const Duration(hours: 1)).toIso8601String(),
      'lastBody': 'Queria falar com alguém sobre o preço',
      'lastAt': DateTime.now().subtract(const Duration(minutes: 7)).toIso8601String(),
      'windowOpen': true,
    },
    {
      'phone': '+5514977776666',
      'name': 'Marcos Silva',
      'role': 'customer',
      'pausedUntil': null,
      'lastBody': 'Recebi seu comprovante! Assim que for conferido eu confirmo.',
      'lastAt': DateTime.now().subtract(const Duration(minutes: 31)).toIso8601String(),
      'windowOpen': true,
    },
  ];
}

Map<String, dynamic> _map(dynamic v) => v is Map<String, dynamic> ? v : (v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{});

void _deepMerge(Map<String, dynamic> base, Map<String, dynamic> patch) {
  patch.forEach((k, v) {
    if (v is Map && base[k] is Map) {
      _deepMerge(base[k] as Map<String, dynamic>, Map<String, dynamic>.from(v));
    } else {
      base[k] = v;
    }
  });
}
