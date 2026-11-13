import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../api/api_client.dart';
import '../../api/automation.dart';
import '../../core/formatters.dart';
import '../../core/launch_options.dart';
import '../../core/open_url.dart';
import '../../state/app_state.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';
import '../components/buttons.dart';
import '../components/inputs.dart';
import '../components/motion.dart';
import '../components/primitives.dart';

/// Tudo do bot do WhatsApp num lugar só: conexão, regras de atendimento,
/// sinal por Pix, comprovantes, conversas, avisos, Google Agenda e Alexa.
class AutomacaoScreen extends StatefulWidget {
  const AutomacaoScreen({super.key});

  @override
  State<AutomacaoScreen> createState() => _AutomacaoScreenState();
}

class _AutomacaoScreenState extends State<AutomacaoScreen> {
  AutomationStatus? _status;
  Map<String, dynamic> _draft = {};
  Map<String, dynamic> _baseline = {};
  String _savedJson = '';
  // muda quando o rascunho é trocado por inteiro, para os campos de texto relerem
  int _gen = 0;
  String? _error;
  bool _saving = false;
  List<PendingPayment> _payments = const [];
  List<ConversationSummary> _conversations = const [];
  Timer? _poll;

  AutomationRepository get _repo => AppScope.read(context).automation;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _load();
      final g = LaunchOptions.google;
      if (g != null) _toast(g == 'ok' ? 'Google Agenda conectado.' : 'Não foi possível conectar o Google Agenda.', error: g != 'ok');
    });
    // Comprovantes e conversas mudam sozinhos: atualiza a cada 30 s
    _poll = Timer.periodic(const Duration(seconds: 30), (_) => _refreshLists());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load({bool keepDraft = false}) async {
    try {
      final s = await _repo.status();
      if (!mounted) return;
      AppScope.read(context).updateBotSettings(s.settings);
      setState(() {
        _status = s;
        _error = null;
        _baseline = _clone(s.settings);
        _savedJson = _encode(_baseline);
        if (!keepDraft || _draft.isEmpty) {
          _draft = _clone(s.settings);
          _gen++;
        }
      });
      await _refreshLists();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _refreshLists() async {
    if (_status == null || !mounted) return;
    try {
      final p = await _repo.payments();
      final c = await _repo.conversations();
      if (mounted) {
        setState(() {
          _payments = p;
          _conversations = c;
        });
      }
    } catch (_) {}
  }

  bool get _dirty => _status != null && _encode(_draft) != _savedJson;

  void _set(String path, dynamic value) {
    setState(() {
      final keys = path.split('.');
      Map<String, dynamic> m = _draft;
      for (final k in keys.take(keys.length - 1)) {
        m = (m[k] ??= <String, dynamic>{}) as Map<String, dynamic>;
      }
      m[keys.last] = value;
    });
  }

  dynamic _get(String path) {
    dynamic m = _draft;
    for (final k in path.split('.')) {
      if (m is! Map) return null;
      m = m[k];
    }
    return m;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final saved = await _repo.saveSettings(_draft);
      if (!mounted) return;
      AppScope.read(context).updateBotSettings(saved);
      setState(() {
        _draft = _clone(saved);
        _baseline = _clone(saved);
        _savedJson = _encode(saved);
        _gen++;
      });
      _toast('Configurações do bot salvas. Já valem para a próxima mensagem.');
    } on ApiException catch (e) {
      _toast(e.message, error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // Ligar/desligar o bot salva na hora, sem levar junto o resto do rascunho.
  Future<void> _toggleAgent(bool on) async {
    setState(() => _draft['agentEnabled'] = on);
    try {
      final saved = await _repo.saveSettings({'agentEnabled': on});
      if (!mounted) return;
      AppScope.read(context).updateBotSettings(saved);
      setState(() {
        _baseline = _clone(saved);
        _savedJson = _encode(saved);
      });
      _toast(on ? 'Bot ligado. Ele volta a responder os clientes.' : 'Bot pausado. Ninguém recebe resposta automática.');
    } on ApiException catch (e) {
      setState(() => _draft['agentEnabled'] = !on);
      _toast(e.message, error: true);
    }
  }

  void _discard() => setState(() {
        _draft = _clone(_baseline);
        _gen++;
      });

  void _toast(String message, {bool error = false}) {
    if (!mounted) return;
    final c = context.colors;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(message, style: AppType.small.copyWith(color: c.t1)),
      backgroundColor: error ? c.redWash : c.surf,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.md),
        side: BorderSide(color: error ? c.red : c.border),
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final s = _status;
    if (_error != null && s == null) {
      return EmptyState(
        icon: Icons.cloud_off_outlined,
        title: 'Serviço de automação indisponível',
        message: _error!,
        action: AppButton(label: 'Tentar de novo', onPressed: _load, variant: ButtonVariant.secondary),
      );
    }
    if (s == null) return const LoadingOverlay(message: 'Carregando a automação');

    final wide = MediaQuery.sizeOf(context).width >= 1180;
    final left = <Widget>[
      if (!s.linked) _ConnectCard(status: s, onDone: _load),
      _AttendanceCard(get: _get, set: _set, status: s),
      _RemindersCard(get: _get, set: _set),
      _PaymentCard(get: _get, set: _set, status: s, onSecrets: (v) async {
        try {
          await _repo.saveSecrets(v);
          _toast('Credenciais do Mercado Pago salvas com segurança.');
          await _load(keepDraft: true);
        } on ApiException catch (e) {
          _toast(e.message, error: true);
        }
      }),
    ];
    final right = <Widget>[
      _PaymentsCard(
        payments: _payments,
        onDecide: (p, ok) async {
          try {
            await _repo.decidePayment(p.id, ok);
            _toast(ok ? 'Pagamento aprovado. O cliente foi avisado no WhatsApp.' : 'Pagamento recusado. O cliente foi avisado.');
            await _refreshLists();
          } on ApiException catch (e) {
            _toast(e.message, error: true);
          }
        },
      ),
      _ConversationsCard(conversations: _conversations, repo: _repo, onChanged: _refreshLists, toast: _toast),
      _NoticeCard(repo: _repo, toast: _toast),
      _IntegrationsCard(status: s, repo: _repo, toast: _toast, reload: () => _load(keepDraft: true), get: _get, set: _set),
    ];

    Widget column(List<Widget> items, int offset) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < items.length; i++) ...[
              StaggeredEntrance(position: offset + i, child: KeyedSubtree(key: ValueKey('$_gen-$i'), child: items[i])),
              const SizedBox(height: Space.lg),
            ],
          ],
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _StatusStrip(status: s, enabled: _get('agentEnabled') == true, onToggle: _toggleAgent),
        const SizedBox(height: Space.lg),
        if (wide)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(flex: 11, child: column(left, 0)),
              const SizedBox(width: Space.lg),
              Expanded(flex: 9, child: column(right, left.length)),
            ],
          )
        else
          column([...left, ...right], 0),
        AnimatedSwitcher(
          duration: context.reactDuration,
          child: _dirty
              ? _SaveBar(
                  key: const ValueKey('save'),
                  saving: _saving,
                  onSave: _save,
                  onDiscard: _discard,
                )
              : const SizedBox.shrink(key: ValueKey('clean')),
        ),
        SizedBox(height: _dirty ? Space.xl : 0),
        Text(
          'As regras valem para todos os canais: WhatsApp, painel e Alexa.',
          style: AppType.caption.copyWith(color: c.t3),
        ),
      ],
    );
  }
}

String _encode(Map<String, dynamic> m) => m.toString();
Map<String, dynamic> _clone(Map<String, dynamic> m) =>
    m.map((k, v) => MapEntry(k, v is Map ? _clone(Map<String, dynamic>.from(v)) : (v is List ? List.of(v) : v)));

typedef _Get = dynamic Function(String path);
typedef _Set = void Function(String path, dynamic value);

// =========================================================== status
class _StatusStrip extends StatelessWidget {
  final AutomationStatus status;
  final bool enabled;
  final ValueChanged<bool> onToggle;
  const _StatusStrip({required this.status, required this.enabled, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.md),
      child: Wrap(
        spacing: Space.sm,
        runSpacing: Space.sm,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          StatusBadge(
            status.whatsappConfigured ? 'WhatsApp configurado' : 'WhatsApp sem número',
            tone: status.whatsappConfigured ? BadgeTone.success : BadgeTone.warning,
            icon: Icons.chat_outlined,
          ),
          StatusBadge(
            status.linked ? 'Automação conectada' : status.linkBroken ? 'Reconecte a automação' : 'Automação não conectada',
            tone: status.linked ? BadgeTone.success : BadgeTone.warning,
            icon: Icons.link_rounded,
          ),
          if (status.pendingPayments > 0)
            StatusBadge('${status.pendingPayments} comprovante(s) para conferir', tone: BadgeTone.info, icon: Icons.receipt_long_outlined),
          StatusBadge(
            status.ai['enabled'] == true ? 'IA ligada' : 'IA desligada (só regras)',
            tone: BadgeTone.neutral,
            icon: Icons.auto_awesome_outlined,
          ),
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 180),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(enabled ? 'Bot respondendo' : 'Bot pausado', style: AppType.small.copyWith(color: c.t2)),
                const SizedBox(width: Space.sm),
                AppSwitch(value: enabled, onChanged: onToggle),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// =========================================================== conexão
class _ConnectCard extends StatefulWidget {
  final AutomationStatus status;
  final VoidCallback onDone;
  const _ConnectCard({required this.status, required this.onDone});

  @override
  State<_ConnectCard> createState() => _ConnectCardState();
}

class _ConnectCardState extends State<_ConnectCard> {
  final _password = TextEditingController();
  bool _busy = false;
  String? _err;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    final state = AppScope.read(context);
    setState(() {
      _busy = true;
      _err = null;
    });
    try {
      await state.automation.link(state.session?.userEmail ?? '', _password.text);
      widget.onDone();
    } on ApiException catch (e) {
      setState(() => _err = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final email = AppScope.of(context).session?.userEmail ?? '';
    return AppCard(
      borderColor: c.amber,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(
            title: widget.status.linkBroken ? 'Reconectar a automação' : 'Conectar a automação',
            subtitle: 'Para o bot ver a agenda inteira, confirmar pagamentos e bloquear horários, confirme sua senha uma vez. '
                'Ela fica guardada cifrada e só é usada pelo bot.',
          ),
          if (widget.status.linkBroken && widget.status.link['lastError'] != null) ...[
            InfoBanner(message: widget.status.link['lastError'].toString(), tone: BannerTone.warning),
            const SizedBox(height: Space.md),
          ],
          Text('Conta: $email', style: AppType.small.copyWith(color: c.t2)),
          const SizedBox(height: Space.md),
          AppTextField(
            label: 'Sua senha do painel',
            controller: _password,
            obscure: true,
            icon: Icons.lock_outline_rounded,
            error: _err,
            onSubmitted: (_) => _connect(),
          ),
          const SizedBox(height: Space.md),
          AppButton(label: 'Conectar', icon: Icons.link_rounded, loading: _busy, onPressed: _connect),
        ],
      ),
    );
  }
}

// =========================================================== atendimento
class _AttendanceCard extends StatefulWidget {
  final _Get get;
  final _Set set;
  final AutomationStatus status;
  const _AttendanceCard({required this.get, required this.set, required this.status});

  @override
  State<_AttendanceCard> createState() => _AttendanceCardState();
}

class _AttendanceCardState extends State<_AttendanceCard> {
  late final _greeting = TextEditingController(text: (widget.get('greeting') ?? '').toString());
  late final _address = TextEditingController(text: (widget.get('address') ?? '').toString());
  late final _maps = TextEditingController(text: (widget.get('mapsUrl') ?? '').toString());
  late final _payments = TextEditingController(text: (widget.get('paymentMethodsText') ?? '').toString());
  late final _owners = TextEditingController(text: ((widget.get('ownerPhones') as List?) ?? const []).join(', '));

  @override
  void dispose() {
    for (final t in [_greeting, _address, _maps, _payments, _owners]) {
      t.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final get = widget.get;
    final set = widget.set;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(title: 'Atendimento', subtitle: 'Como o bot se apresenta e fala com os clientes.'),
          AppSelect<String>(
            label: 'Tipo de estabelecimento',
            value: (get('segment') ?? 'outro').toString(),
            options: [for (final s in widget.status.segments) (value: s.id, label: s.label)],
            onChanged: (v) => set('segment', v ?? 'outro'),
          ),
          const SizedBox(height: Space.md),
          AppTextField(
            label: 'Saudação (opcional)',
            controller: _greeting,
            hint: 'Olá! Aqui é a Barbearia Navalha. Como posso ajudar?',
            helper: 'Em branco, o bot usa uma saudação com o nome do cliente.',
            onChanged: (v) => set('greeting', v),
          ),
          const SizedBox(height: Space.md),
          _TwoUp(
            left: AppTextField(label: 'Endereço', controller: _address, icon: Icons.place_outlined, onChanged: (v) => set('address', v)),
            right: AppTextField(label: 'Link do mapa (opcional)', controller: _maps, icon: Icons.map_outlined, onChanged: (v) => set('mapsUrl', v)),
          ),
          const SizedBox(height: Space.md),
          _TwoUp(
            left: AppTextField(label: 'Formas de pagamento', controller: _payments, onChanged: (v) => set('paymentMethodsText', v)),
            right: AppTextField(
              label: 'Números do dono',
              controller: _owners,
              hint: '(14) 99999-0000',
              helper: 'Separe por vírgula. Esses números recebem os comandos de dono.',
              keyboardType: TextInputType.phone,
              onChanged: (v) => set('ownerPhones', v.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList()),
            ),
          ),
          const AppDivider(vertical: Space.lg),
          SettingRow(
            title: 'Perguntar o profissional',
            description: 'Quando mais de um profissional faz o serviço, o cliente pode escolher.',
            value: get('askProfessional') == true,
            onChanged: (v) => set('askProfessional', v),
          ),
          const AppDivider(vertical: Space.md),
          SettingRow(
            title: 'Avisar o dono a cada agendamento',
            description: 'Novos horários, cancelamentos e remarcações chegam no seu WhatsApp.',
            value: get('notifyOwner.newBooking') == true,
            onChanged: (v) {
              set('notifyOwner.newBooking', v);
              set('notifyOwner.cancellation', v);
              set('notifyOwner.reschedule', v);
            },
          ),
          const AppDivider(vertical: Space.md),
          NumberStepper(
            label: 'Pausa do bot no atendimento humano',
            value: (get('handoffHours') as num?)?.toInt() ?? 2,
            suffix: 'h',
            min: 1,
            max: 24,
            onChanged: (v) => set('handoffHours', v),
          ),
        ],
      ),
    );
  }
}

class _TwoUp extends StatelessWidget {
  final Widget left;
  final Widget right;
  const _TwoUp({required this.left, required this.right});

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, box) => box.maxWidth < 520
            ? Column(children: [left, const SizedBox(height: Space.md), right])
            : Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: left),
                const SizedBox(width: Space.md),
                Expanded(child: right),
              ]),
      );
}

// =========================================================== lembretes
class _RemindersCard extends StatelessWidget {
  final _Get get;
  final _Set set;
  const _RemindersCard({required this.get, required this.set});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final hours = ((get('reminders.hoursBefore') as List?) ?? const []).map((e) => (e as num).toInt()).toList();
    Widget chip(int h, String label) {
      final on = hours.contains(h);
      return FilterChip(
        label: Text(label),
        selected: on,
        showCheckmark: false,
        labelStyle: AppType.small.copyWith(color: on ? c.onPrimary : c.t1),
        selectedColor: c.primary,
        backgroundColor: c.surf,
        side: BorderSide(color: on ? c.primary : c.border),
        onSelected: (v) {
          final next = [...hours]..remove(h);
          if (v) next.add(h);
          next.sort((a, b) => b.compareTo(a));
          set('reminders.hoursBefore', next.take(3).toList());
        },
      );
    }

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(title: 'Lembretes e resumo', subtitle: 'O que o bot manda sozinho, sem você pedir.'),
          SettingRow(
            title: 'Lembrar o cliente antes do horário',
            description: 'Com botões para confirmar, remarcar ou cancelar.',
            value: get('reminders.enabled') == true,
            onChanged: (v) => set('reminders.enabled', v),
            child: Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
              chip(48, '2 dias antes'),
              chip(24, '1 dia antes'),
              chip(3, '3 horas antes'),
              chip(2, '2 horas antes'),
              chip(1, '1 hora antes'),
            ]),
          ),
          const AppDivider(vertical: Space.md),
          SettingRow(
            title: 'Resumo do dia no seu WhatsApp',
            description: 'Todo dia de manhã: quem vem, quanto está previsto e comprovantes pendentes.',
            value: get('dailySummary.enabled') == true,
            onChanged: (v) => set('dailySummary.enabled', v),
            child: get('dailySummary.enabled') == true
                ? SizedBox(
                    width: 200,
                    child: AppSelect<String>(
                      label: 'Horário do resumo',
                      value: (get('dailySummary.time') ?? '08:00').toString(),
                      options: [
                        // o valor salvo sempre aparece, mesmo fora da lista padrão
                        for (final h in {
                          ...const ['06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '11:00'],
                          (get('dailySummary.time') ?? '08:00').toString(),
                        }.toList()..sort())
                          (value: h, label: h),
                      ],
                      onChanged: (v) => set('dailySummary.time', v ?? '08:00'),
                    ),
                  )
                : null,
          ),
        ],
      ),
    );
  }
}

// =========================================================== sinal e Pix
class _PaymentCard extends StatefulWidget {
  final _Get get;
  final _Set set;
  final AutomationStatus status;
  final Future<void> Function(Map<String, String>) onSecrets;
  const _PaymentCard({required this.get, required this.set, required this.status, required this.onSecrets});

  @override
  State<_PaymentCard> createState() => _PaymentCardState();
}

class _PaymentCardState extends State<_PaymentCard> {
  late final _key = TextEditingController(text: (widget.get('prepayment.pixKey') ?? '').toString());
  late final _name = TextEditingController(text: (widget.get('prepayment.merchantName') ?? '').toString());
  late final _city = TextEditingController(text: (widget.get('prepayment.merchantCity') ?? '').toString());
  final _mpToken = TextEditingController();
  final _mpSecret = TextEditingController();

  @override
  void dispose() {
    for (final t in [_key, _name, _city, _mpToken, _mpSecret]) {
      t.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final get = widget.get;
    final set = widget.set;
    final mode = (get('prepayment.mode') ?? 'off').toString();
    final provider = (get('prepayment.provider') ?? 'static_pix').toString();
    final percent = (get('prepayment.depositType') ?? 'percent') == 'percent';
    final mpOk = widget.status.secrets['mercadoPagoAccessToken'] == true;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            title: 'Sinal e pagamento antecipado',
            subtitle: 'O cliente paga por Pix para garantir o horário, com desconto se pagar tudo.',
          ),
          SegmentedControl<String>(
            expand: true,
            selected: mode,
            onChanged: (v) => set('prepayment.mode', v),
            options: const [
              (value: 'off', label: 'Desligado', icon: null),
              (value: 'optional', label: 'Opcional', icon: null),
              (value: 'required', label: 'Obrigatório', icon: null),
            ],
          ),
          const SizedBox(height: Space.sm),
          Text(
            switch (mode) {
              'required' => 'Sem o sinal pago no prazo, o horário é liberado automaticamente.',
              'optional' => 'O cliente escolhe: pagar o sinal, pagar tudo com desconto ou pagar no local.',
              _ => 'O bot não pede pagamento. O cliente paga no dia.',
            },
            style: AppType.small.copyWith(color: c.t2, height: 1.45),
          ),
          if (mode != 'off') ...[
            const AppDivider(vertical: Space.lg),
            SegmentedControl<String>(
              selected: percent ? 'percent' : 'fixed',
              onChanged: (v) => set('prepayment.depositType', v),
              options: const [
                (value: 'percent', label: 'Sinal em %', icon: Icons.percent_rounded),
                (value: 'fixed', label: 'Valor fixo', icon: Icons.attach_money_rounded),
              ],
            ),
            const SizedBox(height: Space.md),
            Wrap(spacing: Space.lg, runSpacing: Space.md, children: [
              percent
                  ? NumberStepper(
                      label: 'Sinal',
                      value: (get('prepayment.depositPercent') as num?)?.toInt() ?? 30,
                      suffix: '%',
                      step: 5,
                      min: 5,
                      max: 100,
                      onChanged: (v) => set('prepayment.depositPercent', v),
                    )
                  : NumberStepper(
                      label: 'Sinal (R\$)',
                      value: ((get('prepayment.depositFixedCents') as num?)?.toInt() ?? 2000) ~/ 100,
                      suffix: '',
                      step: 5,
                      min: 1,
                      max: 500,
                      onChanged: (v) => set('prepayment.depositFixedCents', v * 100),
                    ),
              NumberStepper(
                label: 'Desconto pagando tudo',
                value: (get('prepayment.fullPaymentDiscountPercent') as num?)?.toInt() ?? 10,
                suffix: '%',
                min: 0,
                max: 50,
                onChanged: (v) => set('prepayment.fullPaymentDiscountPercent', v),
              ),
              NumberStepper(
                label: 'Prazo para pagar',
                value: (get('prepayment.expiresMinutes') as num?)?.toInt() ?? 30,
                suffix: 'min',
                step: 5,
                min: 5,
                max: 240,
                onChanged: (v) => set('prepayment.expiresMinutes', v),
              ),
            ]),
            const AppDivider(vertical: Space.lg),
            Text('Como o Pix é gerado', style: AppType.h3.copyWith(color: c.t1)),
            const SizedBox(height: Space.sm),
            SegmentedControl<String>(
              expand: true,
              selected: provider,
              onChanged: (v) => set('prepayment.provider', v),
              options: const [
                (value: 'static_pix', label: 'Minha chave Pix', icon: Icons.key_outlined),
                (value: 'mercadopago', label: 'Mercado Pago', icon: Icons.verified_outlined),
              ],
            ),
            const SizedBox(height: Space.md),
            if (provider == 'static_pix') ...[
              const InfoBanner(
                message: 'O cliente manda a foto do comprovante e você aprova aqui ou no WhatsApp. '
                    'Confira sempre se o valor caiu na conta: foto de comprovante pode ser editada.',
                tone: BannerTone.warning,
              ),
              const SizedBox(height: Space.md),
              AppTextField(
                label: 'Chave Pix',
                controller: _key,
                hint: 'CPF, CNPJ, e-mail, telefone ou chave aleatória',
                onChanged: (v) => set('prepayment.pixKey', v),
              ),
              const SizedBox(height: Space.md),
              _TwoUp(
                left: AppTextField(
                  label: 'Nome do recebedor',
                  controller: _name,
                  helper: 'Até 25 letras, como aparece no banco.',
                  formatters: [LengthLimitingTextInputFormatter(25)],
                  onChanged: (v) => set('prepayment.merchantName', v),
                ),
                right: AppTextField(
                  label: 'Cidade',
                  controller: _city,
                  formatters: [LengthLimitingTextInputFormatter(15)],
                  onChanged: (v) => set('prepayment.merchantCity', v),
                ),
              ),
            ] else ...[
              InfoBanner(
                message: mpOk
                    ? 'Mercado Pago conectado. O pagamento é confirmado sozinho, sem comprovante.'
                    : 'Cole o Access Token de produção do Mercado Pago (Seu negócio → Configurações → Credenciais).',
                tone: mpOk ? BannerTone.success : BannerTone.info,
              ),
              const SizedBox(height: Space.md),
              AppTextField(label: mpOk ? 'Trocar Access Token' : 'Access Token', controller: _mpToken, obscure: true, icon: Icons.key_outlined),
              const SizedBox(height: Space.md),
              AppTextField(
                label: 'Assinatura secreta do webhook (opcional)',
                controller: _mpSecret,
                obscure: true,
                helper: 'Em Webhooks do Mercado Pago. Faz o sistema recusar avisos falsos.',
              ),
              const SizedBox(height: Space.md),
              AppButton(
                label: 'Salvar credenciais',
                variant: ButtonVariant.secondary,
                icon: Icons.save_outlined,
                onPressed: () {
                  final v = <String, String>{
                    if (_mpToken.text.trim().isNotEmpty) 'mercadoPagoAccessToken': _mpToken.text.trim(),
                    if (_mpSecret.text.trim().isNotEmpty) 'mercadoPagoWebhookSecret': _mpSecret.text.trim(),
                  };
                  if (v.isEmpty) return;
                  widget.onSecrets(v);
                  _mpToken.clear();
                  _mpSecret.clear();
                },
              ),
            ],
          ],
          const AppDivider(vertical: Space.lg),
          Text('Cancelamento', style: AppType.h3.copyWith(color: c.t1)),
          const SizedBox(height: Space.sm),
          NumberStepper(
            label: 'Cancelar ou remarcar pelo bot até',
            value: (get('cancellation.minHoursBefore') as num?)?.toInt() ?? 2,
            suffix: 'h antes',
            min: 0,
            max: 48,
            onChanged: (v) => set('cancellation.minHoursBefore', v),
          ),
          const SizedBox(height: Space.md),
          SettingRow(
            title: 'Devolver o sinal se cancelar',
            description: 'Desligado: o bot avisa que o sinal não é devolvido.',
            value: get('cancellation.depositRefundable') == true,
            onChanged: (v) => set('cancellation.depositRefundable', v),
          ),
          const AppDivider(vertical: Space.lg),
          Text('Lucro estimado', style: AppType.h3.copyWith(color: c.t1)),
          const SizedBox(height: 3),
          Text('Custo médio sobre o faturamento (material, comissão, aluguel). Usado quando você pergunta o lucro.',
              style: AppType.small.copyWith(color: c.t2, height: 1.45)),
          const SizedBox(height: Space.sm),
          NumberStepper(
            label: 'Custo médio',
            value: (get('costPercent') as num?)?.toInt() ?? 0,
            suffix: '%',
            step: 5,
            min: 0,
            max: 95,
            onChanged: (v) => set('costPercent', v),
          ),
        ],
      ),
    );
  }
}

// =========================================================== comprovantes
class _PaymentsCard extends StatelessWidget {
  final List<PendingPayment> payments;
  final void Function(PendingPayment, bool) onDecide;
  const _PaymentsCard({required this.payments, required this.onDecide});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(
            title: 'Comprovantes para conferir',
            subtitle: 'Aprove só depois de ver o Pix na sua conta.',
            trailing: payments.isEmpty ? null : StatusBadge('${payments.length}', tone: BadgeTone.info),
          ),
          if (payments.isEmpty)
            Text('Nenhum comprovante esperando. 👍', style: AppType.small.copyWith(color: c.t2))
          else
            for (final p in payments) ...[
              Container(
                padding: const EdgeInsets.all(Space.md),
                decoration: BoxDecoration(
                  color: c.surf,
                  borderRadius: BorderRadius.circular(Radii.md),
                  border: Border.all(color: c.border),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _ReceiptThumb(url: p.receiptUrl),
                    const SizedBox(width: Space.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(p.customerName, style: AppType.bodyStrong.copyWith(color: c.t1), overflow: TextOverflow.ellipsis),
                          Text(
                            '${p.kind == 'deposit' ? 'Sinal' : 'Pagamento total'} de ${formatCurrency(p.amountCents)} · ${p.service}',
                            style: AppType.small.copyWith(color: c.t2),
                          ),
                          Text('${_shortDate(p.date)} às ${p.time}', style: AppType.caption.copyWith(color: c.t3)),
                          if (p.analysis != null) ...[
                            const SizedBox(height: 4),
                            Text('🔎 ${p.analysis}', style: AppType.caption.copyWith(color: c.t2)),
                          ],
                          const SizedBox(height: Space.sm),
                          Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
                            AppButton(label: 'Aprovar', size: ButtonSize.small, icon: Icons.check_rounded, onPressed: () => onDecide(p, true)),
                            AppButton(label: 'Recusar', size: ButtonSize.small, variant: ButtonVariant.ghost, onPressed: () => onDecide(p, false)),
                          ]),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: Space.sm),
            ],
        ],
      ),
    );
  }
}

String _shortDate(String iso) {
  final d = DateTime.tryParse(iso);
  if (d == null) return iso;
  return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
}

class _ReceiptThumb extends StatelessWidget {
  final String? url;
  const _ReceiptThumb({required this.url});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final box = BoxDecoration(color: c.card, borderRadius: BorderRadius.circular(Radii.sm), border: Border.all(color: c.border));
    final placeholder = Container(width: 56, height: 72, decoration: box, child: Icon(Icons.receipt_long_outlined, color: c.t3));
    if (url == null) return placeholder;
    return GestureDetector(
      onTap: () => showDialog<void>(
        context: context,
        builder: (_) => Dialog(
          backgroundColor: c.card,
          child: InteractiveViewer(child: Image.network(url!, fit: BoxFit.contain, errorBuilder: (_, __, ___) => placeholder)),
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(Radii.sm),
        child: Image.network(url!, width: 56, height: 72, fit: BoxFit.cover, errorBuilder: (_, __, ___) => placeholder),
      ),
    );
  }
}

// =========================================================== conversas
class _ConversationsCard extends StatelessWidget {
  final List<ConversationSummary> conversations;
  final AutomationRepository repo;
  final Future<void> Function() onChanged;
  final void Function(String, {bool error}) toast;
  const _ConversationsCard({required this.conversations, required this.repo, required this.onChanged, required this.toast});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final list = conversations.where((x) => x.role == 'customer').take(8).toList();
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(title: 'Conversas', subtitle: 'O que o bot está falando com os clientes. Toque para ver e responder.'),
          if (list.isEmpty)
            Text('Nenhuma conversa ainda.', style: AppType.small.copyWith(color: c.t2))
          else
            for (final conv in list)
              InkWell(
                borderRadius: BorderRadius.circular(Radii.md),
                onTap: () => _open(context, conv),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: Space.sm, horizontal: Space.xs),
                  child: Row(children: [
                    Avatar(name: conv.name, size: 34),
                    const SizedBox(width: Space.md),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Flexible(child: Text(conv.name, style: AppType.bodyStrong.copyWith(color: c.t1), overflow: TextOverflow.ellipsis)),
                          if (conv.paused) ...[
                            const SizedBox(width: Space.sm),
                            const StatusBadge('humano', tone: BadgeTone.warning),
                          ],
                        ]),
                        Text(conv.lastBody, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.small.copyWith(color: c.t2)),
                      ]),
                    ),
                    if (conv.lastAt != null) ...[
                      const SizedBox(width: Space.sm),
                      Text(_ago(conv.lastAt!), style: AppType.caption.copyWith(color: c.t3)),
                    ],
                  ]),
                ),
              ),
        ],
      ),
    );
  }

  Future<void> _open(BuildContext context, ConversationSummary conv) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: context.colors.card,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.xl))),
      builder: (_) => _ChatSheet(conv: conv, repo: repo, toast: toast),
    );
    await onChanged();
  }
}

String _ago(DateTime t) {
  final d = DateTime.now().difference(t);
  if (d.inMinutes < 1) return 'agora';
  if (d.inMinutes < 60) return '${d.inMinutes} min';
  if (d.inHours < 24) return '${d.inHours} h';
  return '${d.inDays} d';
}

class _ChatSheet extends StatefulWidget {
  final ConversationSummary conv;
  final AutomationRepository repo;
  final void Function(String, {bool error}) toast;
  const _ChatSheet({required this.conv, required this.repo, required this.toast});

  @override
  State<_ChatSheet> createState() => _ChatSheetState();
}

class _ChatSheetState extends State<_ChatSheet> {
  List<ChatLine>? _lines;
  final _text = TextEditingController();
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final l = await widget.repo.history(widget.conv.phone);
    if (mounted) setState(() => _lines = l);
  }

  Future<void> _send() async {
    final t = _text.text.trim();
    if (t.isEmpty) return;
    setState(() => _sending = true);
    try {
      await widget.repo.reply(widget.conv.phone, t);
      _text.clear();
      await _load();
    } on ApiException catch (e) {
      widget.toast(e.message, error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final h = MediaQuery.sizeOf(context).height;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: h * 0.85, maxWidth: 720),
        child: Padding(
          padding: const EdgeInsets.all(Space.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(children: [
                Avatar(name: widget.conv.name, size: 36),
                const SizedBox(width: Space.md),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(widget.conv.name, style: AppType.h3.copyWith(color: c.t1), overflow: TextOverflow.ellipsis),
                    Text(widget.conv.phone, style: AppType.caption.copyWith(color: c.t3)),
                  ]),
                ),
                if (widget.conv.paused)
                  AppButton(
                    label: 'Reativar bot',
                    size: ButtonSize.small,
                    variant: ButtonVariant.secondary,
                    onPressed: () async {
                      await widget.repo.resume(widget.conv.phone);
                      if (context.mounted) Navigator.of(context).pop();
                    },
                  ),
              ]),
              const AppDivider(vertical: Space.md),
              Flexible(
                child: _lines == null
                    ? const Padding(padding: EdgeInsets.all(Space.xl), child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
                    : ListView(
                        shrinkWrap: true,
                        reverse: true,
                        children: [
                          for (final l in _lines!.reversed)
                            Align(
                              alignment: l.fromCustomer ? Alignment.centerLeft : Alignment.centerRight,
                              child: Container(
                                constraints: const BoxConstraints(maxWidth: 440),
                                margin: const EdgeInsets.symmetric(vertical: 3),
                                padding: const EdgeInsets.symmetric(horizontal: Space.md, vertical: Space.sm),
                                decoration: BoxDecoration(
                                  color: l.fromCustomer ? c.surf : c.primaryWash,
                                  borderRadius: BorderRadius.circular(Radii.md),
                                ),
                                child: Text(l.body, style: AppType.small.copyWith(color: c.t1, height: 1.4)),
                              ),
                            ),
                        ],
                      ),
              ),
              const SizedBox(height: Space.md),
              if (widget.conv.windowOpen)
                Row(children: [
                  Expanded(child: AppTextField(label: 'Responder como o estabelecimento', controller: _text, onSubmitted: (_) => _send())),
                  const SizedBox(width: Space.sm),
                  AppButton(label: 'Enviar', icon: Icons.send_rounded, loading: _sending, onPressed: _send),
                ])
              else
                const InfoBanner(
                  message: 'Passaram 24 horas desde a última mensagem do cliente. A Meta só deixa falar com ele por modelo aprovado.',
                  tone: BannerTone.info,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// =========================================================== aviso aos clientes
class _NoticeCard extends StatefulWidget {
  final AutomationRepository repo;
  final void Function(String, {bool error}) toast;
  const _NoticeCard({required this.repo, required this.toast});

  @override
  State<_NoticeCard> createState() => _NoticeCardState();
}

class _NoticeCardState extends State<_NoticeCard> {
  final _msg = TextEditingController();
  bool _tomorrow = false;
  bool _busy = false;

  @override
  void dispose() {
    _msg.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_msg.text.trim().length < 3) return;
    setState(() => _busy = true);
    final day = DateTime.now().add(Duration(days: _tomorrow ? 1 : 0));
    final iso = '${day.year}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';
    try {
      final n = await widget.repo.notice(iso, _msg.text.trim());
      widget.toast(n == 0 ? 'Não há clientes marcados para avisar.' : 'Aviso enviado para $n cliente(s).');
      if (n > 0) _msg.clear();
    } on ApiException catch (e) {
      widget.toast(e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(title: 'Avisar clientes', subtitle: 'Manda um recado no WhatsApp de quem está marcado.'),
          SegmentedControl<bool>(
            selected: _tomorrow,
            onChanged: (v) => setState(() => _tomorrow = v),
            options: const [
              (value: false, label: 'Clientes de hoje', icon: null),
              (value: true, label: 'De amanhã', icon: null),
            ],
          ),
          const SizedBox(height: Space.md),
          AppTextField(label: 'Mensagem', controller: _msg, hint: 'Ex.: Vou atrasar uns 20 minutos, desculpem!'),
          const SizedBox(height: Space.md),
          AppButton(label: 'Enviar aviso', icon: Icons.campaign_outlined, loading: _busy, onPressed: _send),
        ],
      ),
    );
  }
}

// =========================================================== integrações
class _IntegrationsCard extends StatefulWidget {
  final AutomationStatus status;
  final AutomationRepository repo;
  final void Function(String, {bool error}) toast;
  final Future<void> Function() reload;
  final _Get get;
  final _Set set;
  const _IntegrationsCard({required this.status, required this.repo, required this.toast, required this.reload, required this.get, required this.set});

  @override
  State<_IntegrationsCard> createState() => _IntegrationsCardState();
}

class _IntegrationsCardState extends State<_IntegrationsCard> {
  String? _code;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final g = widget.status.google;
    final googleOn = g['connected'] == true;
    final devices = (widget.status.alexa['linkedDevices'] as num?)?.toInt() ?? 0;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(title: 'Integrações', subtitle: 'Onde mais a sua agenda aparece.'),
          // ---------------- Google
          Row(children: [
            Icon(Icons.event_outlined, color: c.t2),
            const SizedBox(width: Space.md),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Google Agenda', style: AppType.bodyStrong.copyWith(color: c.t1)),
                Text(
                  googleOn ? 'Conectado${g['email'] != null ? ' como ${g['email']}' : ''}' : 'Cada agendamento vira um evento no seu Google Agenda.',
                  style: AppType.small.copyWith(color: c.t2),
                ),
              ]),
            ),
          ]),
          const SizedBox(height: Space.sm),
          Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
            if (!googleOn)
              AppButton(
                label: 'Conectar Google Agenda',
                size: ButtonSize.small,
                variant: ButtonVariant.secondary,
                onPressed: g['available'] == false
                    ? null
                    : () async {
                        try {
                          final url = await widget.repo.googleConnectUrl();
                          if (url == null) return widget.toast('No modo demonstração a conexão com o Google fica desligada.');
                          await Clipboard.setData(ClipboardData(text: url));
                          widget.toast('Abra o link copiado para autorizar o Google Agenda.');
                          _openUrl(url);
                        } on ApiException catch (e) {
                          widget.toast(e.message, error: true);
                        }
                      },
              )
            else ...[
              AppButton(
                label: 'Sincronizar agora',
                size: ButtonSize.small,
                variant: ButtonVariant.secondary,
                onPressed: () async {
                  await widget.repo.googleSync();
                  widget.toast('Google Agenda sincronizado.');
                },
              ),
              AppButton(
                label: 'Desconectar',
                size: ButtonSize.small,
                variant: ButtonVariant.ghost,
                onPressed: () async {
                  await widget.repo.googleDisconnect();
                  await widget.reload();
                },
              ),
            ],
          ]),
          if (g['available'] == false)
            Padding(
              padding: const EdgeInsets.only(top: Space.sm),
              child: Text('O servidor ainda não tem as credenciais do Google configuradas.', style: AppType.caption.copyWith(color: c.t3)),
            ),
          if (googleOn) ...[
            const SizedBox(height: Space.md),
            SettingRow(
              title: 'Compromissos do Google bloqueiam a agenda',
              description: 'Um compromisso pessoal no Google vira horário bloqueado aqui.',
              value: widget.get('google.importBusy') == true,
              onChanged: (v) => widget.set('google.importBusy', v),
            ),
          ],
          const AppDivider(vertical: Space.lg),
          // ---------------- Alexa
          Row(children: [
            Icon(Icons.speaker_outlined, color: c.t2),
            const SizedBox(width: Space.md),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Alexa', style: AppType.bodyStrong.copyWith(color: c.t1)),
                Text(
                  devices > 0 ? '$devices dispositivo(s) vinculado(s).' : 'Pergunte a agenda, o faturamento e bloqueie horários por voz.',
                  style: AppType.small.copyWith(color: c.t2),
                ),
              ]),
            ),
          ]),
          const SizedBox(height: Space.sm),
          if (_code != null) ...[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(Space.md),
              decoration: BoxDecoration(color: c.surf, borderRadius: BorderRadius.circular(Radii.md), border: Border.all(color: c.border)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Diga para a Alexa:', style: AppType.small.copyWith(color: c.t2)),
                const SizedBox(height: 4),
                Text('"Alexa, abrir agenda convexa"', style: AppType.bodyStrong.copyWith(color: c.t1)),
                Text('e depois: "vincular código ${_code!.split('').join(' ')}"', style: AppType.bodyStrong.copyWith(color: c.t1)),
                const SizedBox(height: 4),
                Text('O código vale por 15 minutos.', style: AppType.caption.copyWith(color: c.t3)),
              ]),
            ),
            const SizedBox(height: Space.sm),
          ],
          Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
            AppButton(
              label: _code == null ? 'Gerar código de vínculo' : 'Gerar outro código',
              size: ButtonSize.small,
              variant: ButtonVariant.secondary,
              onPressed: () async {
                try {
                  final code = await widget.repo.alexaCode();
                  setState(() => _code = code);
                } on ApiException catch (e) {
                  widget.toast(e.message, error: true);
                }
              },
            ),
            if (devices > 0)
              AppButton(
                label: 'Desvincular',
                size: ButtonSize.small,
                variant: ButtonVariant.ghost,
                onPressed: () async {
                  await widget.repo.alexaUnlink();
                  await widget.reload();
                },
              ),
          ]),
        ],
      ),
    );
  }
}

// abre o consentimento do Google numa aba nova (web) ou só deixa copiado
void _openUrl(String url) => openExternal(url);

// =========================================================== barra de salvar
class _SaveBar extends StatelessWidget {
  final bool saving;
  final VoidCallback onSave;
  final VoidCallback onDiscard;
  const _SaveBar({super.key, required this.saving, required this.onSave, required this.onDiscard});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return AppCard(
      background: c.primaryWash,
      borderColor: c.primary,
      padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.md),
      child: Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: Space.md,
        runSpacing: Space.sm,
        children: [
          Text('Você tem alterações não salvas.', style: AppType.bodyStrong.copyWith(color: c.t1)),
          Wrap(spacing: Space.sm, children: [
            AppButton(label: 'Descartar', variant: ButtonVariant.ghost, onPressed: saving ? null : onDiscard),
            AppButton(label: 'Salvar', icon: Icons.check_rounded, loading: saving, onPressed: onSave),
          ]),
        ],
      ),
    );
  }
}
