import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../api/api_client.dart';
import '../../state/app_state.dart';
import '../../theme/app_theme.dart';
import '../../theme/palettes.dart';
import '../../theme/tokens.dart';
import '../components/buttons.dart';
import '../components/inputs.dart';
import '../components/motion.dart';
import '../components/primitives.dart';

/// Configurações do estabelecimento: aparência e conexão com o WhatsApp.
/// As regras do bot (lembretes, sinal, Pix, integrações) ficam em Automação.
class ConfiguracoesScreen extends StatelessWidget {
  const ConfiguracoesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        StaggeredEntrance(position: 0, child: AppearanceCard()),
        SizedBox(height: Space.lg),
        StaggeredEntrance(position: 1, child: _WhatsAppCard()),
        SizedBox(height: Space.lg),
        StaggeredEntrance(position: 2, child: _AutomationLinkCard()),
      ],
    );
  }
}

class _AutomationLinkCard extends StatelessWidget {
  const _AutomationLinkCard();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return AppCard(
      child: Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: Space.lg,
        runSpacing: Space.md,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Bot do WhatsApp', style: AppType.h3.copyWith(color: c.t1)),
                const SizedBox(height: 3),
                Text(
                  'Lembretes, sinal por Pix, comprovantes, conversas, Google Agenda e Alexa ficam na aba Automação.',
                  style: AppType.small.copyWith(color: c.t2, height: 1.45),
                ),
              ],
            ),
          ),
          AppButton(
            label: 'Abrir Automação',
            icon: Icons.arrow_forward_rounded,
            variant: ButtonVariant.secondary,
            onPressed: () => AppScope.read(context).openTab('Automação'),
          ),
        ],
      ),
    );
  }
}

class _WhatsAppCard extends StatefulWidget {
  const _WhatsAppCard();

  @override
  State<_WhatsAppCard> createState() => _WhatsAppCardState();
}

class _WhatsAppCardState extends State<_WhatsAppCard> {
  final _phone = TextEditingController();
  final _phoneNumberId = TextEditingController();
  final _wabaId = TextEditingController();
  final _token = TextEditingController();
  final _secret = TextEditingController();
  Map<String, dynamic>? _business;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    for (final t in [_phone, _phoneNumberId, _wabaId, _token, _secret]) {
      t.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final b = await AppScope.read(context).business.get();
      if (!mounted) return;
      setState(() {
        _business = b;
        _phone.text = (b['phone'] ?? '').toString();
        _phoneNumberId.text = (b['metaPhoneNumberId'] ?? '').toString();
        _wabaId.text = (b['metaWabaId'] ?? '').toString();
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _save() async {
    final b = _business ?? const {};
    String changed(TextEditingController t, String key) =>
        t.text.trim() == (b[key] ?? '').toString() ? '' : t.text.trim();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final next = await AppScope.read(context).business.update({
        'phone': changed(_phone, 'phone'),
        'metaPhoneNumberId': changed(_phoneNumberId, 'metaPhoneNumberId'),
        'metaWabaId': changed(_wabaId, 'metaWabaId'),
        'metaAccessToken': _token.text,
        'metaAppSecret': _secret.text,
      });
      if (!mounted) return;
      _token.clear();
      _secret.clear();
      setState(() => _business = next);
      final c = context.colors;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Dados do WhatsApp salvos.', style: AppType.small.copyWith(color: c.t1)),
        backgroundColor: c.surf,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.md),
          side: BorderSide(color: c.border),
        ),
      ));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final connected = (_business?['metaPhoneNumberId'] ?? '').toString().isNotEmpty;
    const webhook = ApiClient.whatsappWebhookUrl;
    Widget pair(Widget a, Widget b) => LayoutBuilder(
          builder: (context, box) => box.maxWidth < 560
              ? Column(children: [a, const SizedBox(height: Space.md), b])
              : Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(child: a),
                  const SizedBox(width: Space.md),
                  Expanded(child: b),
                ]),
        );

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(
            title: 'WhatsApp do estabelecimento',
            subtitle: 'O número que atende os clientes, pela API oficial do WhatsApp (Meta).',
            trailing: _business == null
                ? null
                : StatusBadge(
                    connected ? 'Conectado' : 'Não conectado',
                    tone: connected ? BadgeTone.success : BadgeTone.warning,
                  ),
          ),
          if (_business == null && _error == null)
            const Padding(
              padding: EdgeInsets.all(Space.lg),
              child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
            )
          else ...[
            AppTextField(
              label: 'Telefone do estabelecimento',
              controller: _phone,
              hint: '(14) 99999-0000',
              helper: 'Aparece para os clientes e é o seu contato de dono.',
              icon: Icons.storefront_outlined,
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: Space.md),
            pair(
              AppTextField(
                label: 'Phone Number ID',
                controller: _phoneNumberId,
                hint: '123456789012345',
                helper: 'Meta → WhatsApp → Configuração da API.',
                keyboardType: TextInputType.number,
              ),
              AppTextField(
                label: 'ID da conta do WhatsApp Business (WABA)',
                controller: _wabaId,
                hint: '123456789012345',
                keyboardType: TextInputType.number,
              ),
            ),
            const SizedBox(height: Space.md),
            pair(
              AppTextField(
                label: 'Token de acesso permanente',
                controller: _token,
                obscure: true,
                icon: Icons.key_outlined,
                helper: 'Em branco mantém o token atual.',
              ),
              AppTextField(
                label: 'Chave secreta do app (App Secret)',
                controller: _secret,
                obscure: true,
                icon: Icons.lock_outline_rounded,
                helper: 'Em branco mantém a atual.',
              ),
            ),
            const SizedBox(height: Space.md),
            const InfoBanner(
              tone: BannerTone.info,
              message: 'O token e a chave secreta vão cifrados para o servidor e nunca voltam para o painel. '
                  'Só o dono do estabelecimento pode alterar estes dados.',
            ),
            if (webhook.isNotEmpty) ...[
              const SizedBox(height: Space.md),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(Space.md),
                decoration: BoxDecoration(
                  color: c.surf,
                  borderRadius: BorderRadius.circular(Radii.md),
                  border: Border.all(color: c.border),
                ),
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('URL do webhook para colar na Meta', style: AppType.caption.copyWith(color: c.t2)),
                      const SizedBox(height: 2),
                      SelectableText(webhook, style: AppType.small.copyWith(color: c.t1)),
                    ]),
                  ),
                  AppIconButton(
                    icon: Icons.copy_rounded,
                    tooltip: 'Copiar',
                    onPressed: () => Clipboard.setData(const ClipboardData(text: webhook)),
                  ),
                ]),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: Space.md),
              InfoBanner(tone: BannerTone.danger, message: _error!),
            ],
            const SizedBox(height: Space.lg),
            Align(
              alignment: Alignment.centerRight,
              child: AppButton(
                label: 'Salvar WhatsApp',
                icon: Icons.check_rounded,
                loading: _saving,
                onPressed: _business == null ? _load : _save,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class AppearanceCard extends StatelessWidget {
  const AppearanceCard({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            title: 'Aparência',
            subtitle: 'Vale só neste aparelho. Não muda nada para os clientes.',
          ),
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: Space.md,
            runSpacing: Space.sm,
            children: [
              Text('Modo', style: AppType.h3.copyWith(color: c.t1)),
              SegmentedControl<bool>(
                selected: state.isDark,
                onChanged: (dark) {
                  if (dark != state.isDark) state.toggleTheme();
                },
                options: const [
                  (value: false, label: 'Claro', icon: Icons.light_mode_outlined),
                  (value: true, label: 'Escuro', icon: Icons.dark_mode_outlined),
                ],
              ),
            ],
          ),
          const AppDivider(),
          Text('Paleta', style: AppType.h3.copyWith(color: c.t1)),
          const SizedBox(height: 3),
          Text(
            'Verde continua significando concluído e âmbar continua significando atenção em todas elas.',
            style: AppType.small.copyWith(color: c.t2, height: 1.5),
          ),
          const SizedBox(height: Space.lg),
          ResponsiveGrid(
            minItemWidth: 168,
            spacing: Space.sm,
            runSpacing: Space.sm,
            children: [
              for (final p in AppPalette.values)
                _PaletteTile(
                  palette: p,
                  selected: p == state.palette,
                  onTap: () => state.setPalette(p),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PaletteTile extends StatelessWidget {
  final AppPalette palette;
  final bool selected;
  final VoidCallback onTap;

  const _PaletteTile({
    required this.palette,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final swatch = palette.swatch(dark: context.isDarkMode);

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: context.reactDuration,
          padding: const EdgeInsets.all(Space.md),
          decoration: BoxDecoration(
            color: selected ? c.primaryWash : c.surf,
            borderRadius: BorderRadius.circular(Radii.md),
            border: Border.all(
              color: selected ? c.primary : c.border,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              // Amostra: fundo, superfície e acento, empilhados como na tela.
              SizedBox(
                width: 34,
                height: 34,
                child: Stack(
                  children: [
                    Container(
                      decoration: BoxDecoration(
                        color: swatch[0],
                        borderRadius: BorderRadius.circular(Radii.sm),
                        border: Border.all(color: c.borderStrong),
                      ),
                    ),
                    Positioned(
                      right: 4,
                      bottom: 4,
                      child: Container(
                        width: 13,
                        height: 13,
                        decoration: BoxDecoration(
                          color: swatch[2],
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: Space.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(palette.label,
                        style: AppType.bodyStrong.copyWith(color: c.t1)),
                    Text(
                      palette.description,
                      overflow: TextOverflow.ellipsis,
                      style: AppType.caption.copyWith(color: c.t2),
                    ),
                  ],
                ),
              ),
              if (selected)
                Icon(Icons.check_circle_rounded, size: 16, color: c.primary),
            ],
          ),
        ),
      ),
    );
  }
}
