import 'dart:async';

import 'package:flutter/material.dart';

import 'core/launch_options.dart';
import 'state/app_state.dart';
import 'theme/app_theme.dart';
import 'ui/brand/logo.dart';
import 'ui/screens/login_screen.dart';
import 'ui/screens/shell_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final state = AppState();
  runApp(ConvexaApp(state: state));
  if (LaunchOptions.demo) {
    unawaited(state.enterDemoMode());
  } else {
    // Reidrata "continuar conectado" em segundo plano; enquanto isso o app mostra
    // um splash (só quando há sessão guardada para restaurar).
    unawaited(state.restoreSession());
  }
}

class ConvexaApp extends StatefulWidget {
  final AppState state;
  const ConvexaApp({super.key, required this.state});

  @override
  State<ConvexaApp> createState() => _ConvexaAppState();
}

class _ConvexaAppState extends State<ConvexaApp> {
  @override
  void dispose() {
    widget.state.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: widget.state,
      child: AnimatedBuilder(
        animation: widget.state,
        builder: (context, _) => AnimatedColors(
          target: widget.state.colors,
          builder: (context, colors) => MaterialApp(
            title: 'Convexa · Painel',
            debugShowCheckedModeBanner: false,
            // Zero: quem conduz a transição é o AnimatedColors. Sem isso o
            // MaterialApp animava o ThemeData por conta própria, com outra
            // duração e outra curva, e os dois ficavam fora de sincronia.
            themeAnimationDuration: Duration.zero,
            theme: buildAppTheme(widget.state.isDark, colors),
            home: widget.state.isRestoringSession
                ? const _BootSplash()
                : widget.state.isSignedIn
                    ? const ShellScreen()
                    : const LoginScreen(),
          ),
        ),
      ),
    );
  }
}

/// Tela curta entre abrir o painel e o `restoreSession` decidir se há uma
/// sessão "continuar conectado" válida.
class _BootSplash extends StatelessWidget {
  const _BootSplash();

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Scaffold(
      backgroundColor: c.bg,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ConvexaLogo(size: 30),
            const SizedBox(height: 24),
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2, color: c.primary),
            ),
          ],
        ),
      ),
    );
  }
}
