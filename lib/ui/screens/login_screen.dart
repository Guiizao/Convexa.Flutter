import 'package:flutter/material.dart';

import '../../core/responsive.dart';
import '../../state/app_state.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';
import '../components/buttons.dart';
import '../components/inputs.dart';
import '../components/primitives.dart';
import '../brand/circuit_backdrop.dart';
import '../brand/logo.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _keepSignedIn = true;
  bool _showPassword = false;
  bool _submitting = false;
  String? _emailError;
  String? _passwordError;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  bool _validate() {
    final email = _email.text.trim();
    setState(() {
      _emailError = email.isEmpty
          ? 'Informe o e-mail cadastrado.'
          : (!email.contains('@') ? 'E-mail em formato inválido.' : null);
      _passwordError =
          _password.text.isEmpty ? 'Informe a senha.' : null;
    });
    return _emailError == null && _passwordError == null;
  }

  Future<void> _submit() async {
    if (_submitting || !_validate()) return;
    setState(() => _submitting = true);
    // API: o token devolvido pelo login fica em memória (ApiClient).
    // Para "continuar conectado" entre recarregamentos da página, persistir
    // o token aqui — ex.: window.localStorage no Flutter Web — e restaurá-lo
    // no boot chamando AuthRepository.me().
    await AppScope.read(context).signIn(_email.text, _password.text);
    if (mounted) setState(() => _submitting = false);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final wide = Responsive.width(context) >= 940;

    if (wide) {
      // O fundo cobre a tela inteira e o degradê o apaga sobre o formulário,
      // em vez de o desenho parar numa borda seca no meio da tela.
      return Scaffold(
        backgroundColor: c.bg,
        body: Stack(
          children: [
            const Positioned.fill(child: CircuitBackdrop()),
            const Positioned.fill(child: BackdropScrim()),
            SafeArea(
              child: Row(
                children: [
                  const Expanded(flex: 5, child: _BrandPanel()),
                  Expanded(
                    flex: 4,
                    child: Center(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(Space.xxxl),
                        child: _form(context),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    // No celular o fundo animado fica atrás do formulário inteiro — antes não
    // existia animação nenhuma nesta largura.
    return Scaffold(
      backgroundColor: c.bg,
      body: Stack(
        children: [
          const Positioned.fill(child: CircuitBackdrop(subdued: true)),
          const Positioned.fill(child: BackdropScrim.centered()),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(Space.xl),
                child: _form(context, compact: true),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _form(BuildContext context, {bool compact = false}) {
    final c = context.colors;
    final state = AppScope.of(context);

    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 380),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (compact) ...[
            const ConvexaLogo(size: 30),
            const SizedBox(height: Space.xxl),
          ],
          Text('Acessar o painel', style: AppType.display.copyWith(color: c.t1)),
          const SizedBox(height: 8),
          Text(
            'Entre com as credenciais do seu estabelecimento para acompanhar a agenda em tempo real.',
            style: AppType.small.copyWith(color: c.t2, height: 1.55),
          ),
          const SizedBox(height: Space.xxl),
          if (state.errorMessage != null) ...[
            InfoBanner(message: state.errorMessage!, tone: BannerTone.danger),
            const SizedBox(height: Space.lg),
          ],
          AppTextField(
            label: 'E-mail',
            controller: _email,
            hint: 'voce@estabelecimento.com.br',
            icon: Icons.alternate_email_rounded,
            keyboardType: TextInputType.emailAddress,
            error: _emailError,
            onSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: Space.lg),
          AppTextField(
            label: 'Senha',
            controller: _password,
            hint: 'Sua senha de acesso',
            icon: Icons.lock_outline_rounded,
            obscure: !_showPassword,
            error: _passwordError,
            onSubmitted: (_) => _submit(),
            suffix: IconButton(
              onPressed: () => setState(() => _showPassword = !_showPassword),
              icon: Icon(
                _showPassword
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
                size: 17,
                color: c.t2,
              ),
              splashRadius: 18,
              tooltip: _showPassword ? 'Ocultar senha' : 'Mostrar senha',
            ),
          ),
          const SizedBox(height: Space.lg),
          Row(
            children: [
              _Checkbox(
                value: _keepSignedIn,
                onChanged: (v) => setState(() => _keepSignedIn = v),
                label: 'Continuar conectado',
              ),
            ],
          ),
          const SizedBox(height: Space.xl),
          AppButton(
            label: 'Entrar',
            size: ButtonSize.large,
            expand: true,
            loading: _submitting,
            onPressed: _submit,
          ),
          const SizedBox(height: Space.lg),
          Row(
            children: [
              Expanded(child: Container(height: 1, color: c.border)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Space.md),
                child: Text('ou', style: AppType.caption.copyWith(color: c.t3)),
              ),
              Expanded(child: Container(height: 1, color: c.border)),
            ],
          ),
          const SizedBox(height: Space.lg),
          AppButton(
            label: 'Explorar em modo demonstração',
            variant: ButtonVariant.secondary,
            size: ButtonSize.large,
            expand: true,
            icon: Icons.play_circle_outline_rounded,
            onPressed: () => AppScope.read(context).enterDemoMode(),
          ),
          const SizedBox(height: Space.md),
          Text(
            'O modo demonstração usa dados de exemplo e não grava nada na sua conta.',
            style: AppType.caption.copyWith(color: c.t3, height: 1.5),
          ),
          const SizedBox(height: Space.xxl),
          const _LoginFooter(),
        ],
      ),
    );
  }
}

class _Checkbox extends StatelessWidget {
  final bool value;
  final ValueChanged<bool> onChanged;
  final String label;

  const _Checkbox({
    required this.value,
    required this.onChanged,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: () => onChanged(!value),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 140),
              width: 17,
              height: 17,
              decoration: BoxDecoration(
                color: value ? c.primary : Colors.transparent,
                borderRadius: BorderRadius.circular(4),
                border: Border.all(color: value ? c.primary : c.borderStrong),
              ),
              child: value
                  ? Icon(Icons.check_rounded,
                      size: 12,
                      color: context.isDarkMode
                          ? const Color(0xFF04120D)
                          : Colors.white)
                  : null,
            ),
            const SizedBox(width: 9),
            Text(label, style: AppType.small.copyWith(color: c.t2)),
          ],
        ),
      ),
    );
  }
}

class _BrandPanel extends StatelessWidget {
  const _BrandPanel();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return SizedBox.expand(
      child: Stack(
        children: [
          Padding(
            padding: const EdgeInsets.all(Space.xxxl),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const ConvexaLogo(size: 30),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 420),
                      child: Text(
                        'A agenda que atende sozinha.',
                        style: AppType.display.copyWith(
                          color: c.t1,
                          fontSize: 34,
                          height: 1.15,
                        ),
                      ),
                    ),
                    const SizedBox(height: Space.lg),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 400),
                      child: Text(
                        'O agente conversa com o cliente pelo WhatsApp, confirma o horário e grava direto na sua agenda. Você acompanha tudo por aqui.',
                        style: AppType.body.copyWith(color: c.t2, height: 1.65),
                      ),
                    ),
                    const SizedBox(height: Space.xxl),
                    const _BrandHighlights(),
                  ],
                ),
                Text(
                  'Convexa · Painel do estabelecimento',
                  style: AppType.caption.copyWith(color: c.t3),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BrandHighlights extends StatelessWidget {
  const _BrandHighlights();

  static const _items = [
    (Icons.chat_bubble_outline_rounded, 'Agendamento por conversa, sem app para o cliente'),
    (Icons.notifications_active_outlined, 'Lembrete automático antes do horário'),
    (Icons.insights_outlined, 'Receita e serviços acompanhados mês a mês'),
  ];

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: _items
          .map((item) => Padding(
                padding: const EdgeInsets.only(bottom: Space.md),
                child: Row(
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: c.primaryWash,
                        borderRadius: BorderRadius.circular(Radii.sm),
                      ),
                      child: Icon(item.$1, size: 14, color: c.primaryText),
                    ),
                    const SizedBox(width: Space.md),
                    Flexible(
                      child: Text(
                        item.$2,
                        style: AppType.small.copyWith(color: c.t2),
                      ),
                    ),
                  ],
                ),
              ))
          .toList(),
    );
  }
}

class _LoginFooter extends StatelessWidget {
  const _LoginFooter();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(height: 1, color: c.border),
        const SizedBox(height: Space.lg),
        Wrap(
          spacing: Space.lg,
          runSpacing: 6,
          children: [
            Text('Termos de uso', style: AppType.caption.copyWith(color: c.t2)),
            Text('Privacidade', style: AppType.caption.copyWith(color: c.t2)),
            Text('Suporte', style: AppType.caption.copyWith(color: c.t2)),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          '© ${DateTime.now().year} Convexa',
          style: AppType.caption.copyWith(color: c.t3),
        ),
      ],
    );
  }
}
