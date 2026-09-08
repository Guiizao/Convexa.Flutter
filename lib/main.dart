import 'package:flutter/material.dart';

import 'state/app_state.dart';
import 'theme/app_theme.dart';
import 'ui/screens/login_screen.dart';
import 'ui/screens/shell_screen.dart';

void main() {
  runApp(ConvexaApp(state: AppState()));
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
        builder: (context, _) => MaterialApp(
          title: 'Convexa · Painel',
          debugShowCheckedModeBanner: false,
          theme: buildAppTheme(widget.state.isDark),
          home: widget.state.isSignedIn
              ? const ShellScreen()
              : const LoginScreen(),
        ),
      ),
    );
  }
}
