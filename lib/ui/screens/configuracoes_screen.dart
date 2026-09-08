import 'package:flutter/material.dart';

import '../../core/formatters.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';
import '../components/buttons.dart';
import '../components/inputs.dart';
import '../components/primitives.dart';

class ConfiguracoesScreen extends StatefulWidget {
  const ConfiguracoesScreen({super.key});

  @override
  State<ConfiguracoesScreen> createState() => _ConfiguracoesScreenState();
}

class _ConfiguracoesScreenState extends State<ConfiguracoesScreen> {
  AgentSettings? _draft;
  bool _saving = false;

  late final TextEditingController _ownerPhone;
  late final TextEditingController _agentPhone;

  @override
  void initState() {
    super.initState();
    // O aviso de "alterações não salvas" lê o texto dos campos direto. Sem
    // escutar os controllers, digitar um telefone não redesenha a tela e o
    // aviso só aparecia quando outra coisa mudava.
    _ownerPhone = TextEditingController()..addListener(_onPhoneEdited);
    _agentPhone = TextEditingController()..addListener(_onPhoneEdited);
  }

  void _onPhoneEdited() {
    if (mounted) setState(() {});
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_draft != null) return;
    final settings = AppScope.of(context).settings;
    _draft = settings;
    _ownerPhone.text = settings.ownerPhone;
    _agentPhone.text = settings.agentPhone;
  }

  @override
  void dispose() {
    _ownerPhone
      ..removeListener(_onPhoneEdited)
      ..dispose();
    _agentPhone
      ..removeListener(_onPhoneEdited)
      ..dispose();
    super.dispose();
  }

  AgentSettings get _current => _draft!;

  void _patch(AgentSettings next) => setState(() => _draft = next);

  bool get _dirty {
    final saved = AppScope.of(context).settings;
    final d = _current;
    return saved.agentEnabled != d.agentEnabled ||
        saved.voiceToText != d.voiceToText ||
        saved.ownerChatCommands != d.ownerChatCommands ||
        saved.googleCalendarSync != d.googleCalendarSync ||
        saved.openingBroadcast != d.openingBroadcast ||
        saved.reminderEnabled != d.reminderEnabled ||
        saved.reminderMinutesBefore != d.reminderMinutesBefore ||
        saved.prepaymentEnabled != d.prepaymentEnabled ||
        saved.prepaymentDiscountPercent != d.prepaymentDiscountPercent ||
        saved.upsellEnabled != d.upsellEnabled ||
        saved.voiceAssistantEnabled != d.voiceAssistantEnabled ||
        saved.upsellServiceIds.join(',') != d.upsellServiceIds.join(',') ||
        saved.ownerPhone != _ownerPhone.text.trim() ||
        saved.agentPhone != _agentPhone.text.trim();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final error = await AppScope.read(context).saveSettings(
      _current.copyWith(
        ownerPhone: _ownerPhone.text.trim(),
        agentPhone: _agentPhone.text.trim(),
      ),
    );
    if (!mounted) return;
    setState(() {
      _saving = false;
      _draft = AppScope.read(context).settings;
    });
    final c = context.colors;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          error ?? 'Configurações salvas. O agente já opera com as novas regras.',
          style: AppType.small.copyWith(color: c.t1),
        ),
        backgroundColor: error != null ? c.redWash : c.surf,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.md),
          side: BorderSide(color: error != null ? c.red : c.border),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = _current;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_dirty) ...[
          InfoBanner(
            tone: BannerTone.warning,
            message: 'Você tem alterações não salvas.',
            action: AppButton(
              label: 'Salvar agora',
              size: ButtonSize.small,
              loading: _saving,
              onPressed: _save,
            ),
          ),
          const SizedBox(height: Space.lg),
        ],
        _AgentCard(
          settings: s,
          ownerPhone: _ownerPhone,
          agentPhone: _agentPhone,
          onChanged: _patch,
        ),
        const SizedBox(height: Space.lg),
        _AutomationCard(settings: s, onChanged: _patch),
        const SizedBox(height: Space.lg),
        _RevenueCard(settings: s, onChanged: _patch),
        const SizedBox(height: Space.lg),
        _IntegrationsCard(settings: s, onChanged: _patch),
        const SizedBox(height: Space.lg),
        Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            AppButton(
              label: 'Descartar',
              variant: ButtonVariant.secondary,
              onPressed: _dirty
                  ? () {
                      final saved = AppScope.read(context).settings;
                      setState(() {
                        _draft = saved;
                        _ownerPhone.text = saved.ownerPhone;
                        _agentPhone.text = saved.agentPhone;
                      });
                    }
                  : null,
            ),
            const SizedBox(width: Space.md),
            AppButton(
              label: 'Salvar configurações',
              icon: Icons.check_rounded,
              loading: _saving,
              onPressed: _dirty ? _save : null,
            ),
          ],
        ),
      ],
    );
  }
}

class _AgentCard extends StatelessWidget {
  final AgentSettings settings;
  final TextEditingController ownerPhone;
  final TextEditingController agentPhone;
  final ValueChanged<AgentSettings> onChanged;

  const _AgentCard({
    required this.settings,
    required this.ownerPhone,
    required this.agentPhone,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            title: 'Agente de WhatsApp',
            subtitle:
                'O número do agente atende os clientes. O seu número serve para você comandar o sistema.',
          ),
          SettingRow(
            title: 'Agente ativo',
            description:
                'Quando desligado, o agente para de responder e nenhum horário novo é marcado sozinho.',
            value: settings.agentEnabled,
            onChanged: (v) => onChanged(settings.copyWith(agentEnabled: v)),
          ),
          const AppDivider(),
          Row(
            children: [
              Expanded(
                child: AppTextField(
                  label: 'Número do agente (atende clientes)',
                  controller: agentPhone,
                  hint: '55 11 90000-0000',
                  icon: Icons.smart_toy_outlined,
                  keyboardType: TextInputType.phone,
                ),
              ),
              const SizedBox(width: Space.md),
              Expanded(
                child: AppTextField(
                  label: 'Seu número (dono)',
                  controller: ownerPhone,
                  hint: '55 11 90000-0000',
                  icon: Icons.person_outline_rounded,
                  keyboardType: TextInputType.phone,
                ),
              ),
            ],
          ),
          const SizedBox(height: Space.md),
          // API: os dois números vão em PUT /api/settings. Quem realmente
          // envia e recebe mensagem é a automação (n8n) via Meta Cloud API —
          // o painel nunca guarda token da Meta.
          InfoBanner(
            tone: BannerTone.info,
            message:
                'Os tokens da Meta e da IA ficam apenas no servidor. O painel só grava os números e as regras de atendimento.',
          ),
          const AppDivider(),
          SettingRow(
            title: 'Entender áudio do cliente',
            description:
                'Mensagens de voz são transcritas antes de o agente interpretar o pedido.',
            value: settings.voiceToText,
            onChanged: (v) => onChanged(settings.copyWith(voiceToText: v)),
          ),
          const AppDivider(),
          SettingRow(
            title: 'Comandos do dono por conversa',
            description:
                'Você pergunta "quantos cortes tenho hoje?" ou manda remarcar o dia, por texto ou áudio, direto no WhatsApp.',
            value: settings.ownerChatCommands,
            onChanged: (v) =>
                onChanged(settings.copyWith(ownerChatCommands: v)),
          ),
        ],
      ),
    );
  }
}

class _AutomationCard extends StatelessWidget {
  final AgentSettings settings;
  final ValueChanged<AgentSettings> onChanged;

  const _AutomationCard({required this.settings, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            title: 'Avisos automáticos',
            subtitle: 'O que o agente dispara sozinho, sem você pedir.',
          ),
          SettingRow(
            title: 'Avisar na abertura do expediente',
            description:
                'Ao abrir o dia, todos os clientes com horário marcado recebem a confirmação de que você abriu.',
            value: settings.openingBroadcast,
            onChanged: (v) => onChanged(settings.copyWith(openingBroadcast: v)),
          ),
          const AppDivider(),
          SettingRow(
            title: 'Lembrete antes do horário',
            description:
                'Reduz falta. O cliente recebe uma mensagem pouco antes do atendimento.',
            value: settings.reminderEnabled,
            onChanged: (v) => onChanged(settings.copyWith(reminderEnabled: v)),
            child: SizedBox(
              width: 220,
              child: NumberStepper(
                label: 'Antecedência do lembrete',
                value: settings.reminderMinutesBefore,
                suffix: ' min',
                step: 15,
                min: 15,
                max: 1440,
                onChanged: (v) =>
                    onChanged(settings.copyWith(reminderMinutesBefore: v)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RevenueCard extends StatelessWidget {
  final AgentSettings settings;
  final ValueChanged<AgentSettings> onChanged;

  const _RevenueCard({required this.settings, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final services = state.serviceList;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            title: 'Receita e presença',
            subtitle:
                'Duas alavancas: garantir que o cliente apareça e aumentar o valor do atendimento.',
          ),
          SettingRow(
            title: 'Pagamento antecipado com desconto',
            description:
                'O agente oferece um desconto para quem paga na hora de agendar. É a forma mais direta de reduzir faltas.',
            value: settings.prepaymentEnabled,
            onChanged: (v) =>
                onChanged(settings.copyWith(prepaymentEnabled: v)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 220,
                  child: NumberStepper(
                    label: 'Desconto oferecido',
                    value: settings.prepaymentDiscountPercent,
                    suffix: '%',
                    step: 1,
                    min: 1,
                    max: 50,
                    onChanged: (v) => onChanged(
                        settings.copyWith(prepaymentDiscountPercent: v)),
                  ),
                ),
                const SizedBox(height: Space.md),
                // API: o link de pagamento é gerado no servidor. A chave do
                // provedor (Stripe/Mercado Pago) nunca vem para o painel.
                InfoBanner(
                  tone: BannerTone.warning,
                  message:
                      'O link de cobrança é gerado no servidor. Configure o provedor de pagamento antes de ativar em produção.',
                ),
              ],
            ),
          ),
          const AppDivider(),
          SettingRow(
            title: 'Sugerir serviço adicional',
            description:
                'Ao fechar um corte, o agente oferece barba ou acabamento no mesmo horário.',
            value: settings.upsellEnabled,
            onChanged: (v) => onChanged(settings.copyWith(upsellEnabled: v)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Serviços que o agente pode sugerir',
                    style: AppType.caption.copyWith(color: c.t2)),
                const SizedBox(height: Space.sm),
                if (services.isEmpty)
                  Text(
                    'Cadastre serviços na aba Serviços para escolher aqui.',
                    style: AppType.small.copyWith(color: c.t3),
                  )
                else
                  Wrap(
                    spacing: Space.sm,
                    runSpacing: Space.sm,
                    children: services.map((service) {
                      final selected =
                          settings.upsellServiceIds.contains(service.id);
                      return MouseRegion(
                        cursor: SystemMouseCursors.click,
                        child: GestureDetector(
                          onTap: () {
                            final next =
                                List<String>.from(settings.upsellServiceIds);
                            if (!next.remove(service.id)) next.add(service.id);
                            onChanged(
                                settings.copyWith(upsellServiceIds: next));
                          },
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: Space.md, vertical: 8),
                            decoration: BoxDecoration(
                              color: selected ? c.primaryWash : c.surf,
                              borderRadius: BorderRadius.circular(Radii.sm),
                              border: Border.all(
                                color: selected
                                    ? c.primary.withValues(alpha: 0.35)
                                    : c.border,
                              ),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  selected
                                      ? Icons.check_rounded
                                      : Icons.add_rounded,
                                  size: 13,
                                  color: selected ? c.primaryText : c.t2,
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  '${service.name} · ${formatCurrency(service.priceCents)}',
                                  style: AppType.caption.copyWith(
                                    color: selected ? c.primaryText : c.t2,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _IntegrationsCard extends StatelessWidget {
  final AgentSettings settings;
  final ValueChanged<AgentSettings> onChanged;

  const _IntegrationsCard({required this.settings, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            title: 'Integrações',
            subtitle: 'Onde mais a agenda do Convexa aparece.',
          ),
          SettingRow(
            title: 'Google Agenda',
            description:
                'Cada agendamento vira um evento com alerta no seu Google Agenda.',
            value: settings.googleCalendarSync,
            onChanged: (v) =>
                onChanged(settings.copyWith(googleCalendarSync: v)),
            // API: a autorização OAuth do Google acontece no servidor.
            // O painel apenas liga/desliga a sincronização.
            child: InfoBanner(
              tone: BannerTone.info,
              message:
                  'A conexão com a conta Google é autorizada no servidor, uma vez por estabelecimento.',
            ),
          ),
          const AppDivider(),
          SettingRow(
            title: 'Assistentes de voz',
            description:
                'Perguntar "quantos horários tenho hoje?" pela Alexa, Google Assistente ou Siri.',
            value: settings.voiceAssistantEnabled,
            onChanged: (v) =>
                onChanged(settings.copyWith(voiceAssistantEnabled: v)),
            child: InfoBanner(
              tone: BannerTone.warning,
              message:
                  'Depende de publicar uma skill/action em cada plataforma. Deixe desligado até isso existir.',
            ),
          ),
        ],
      ),
    );
  }
}
