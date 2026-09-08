import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import 'logo.dart';

/// Fundo animado de raios de luz, inspirado no efeito "light rays" do Spell UI
/// (que usa shader WebGL). Aqui é feito em CustomPainter para não depender de
/// pacote externo nem de WebGL — roda igual em Flutter Web e nativo.
class LightRaysBackdrop extends StatefulWidget {
  final Alignment origin;

  const LightRaysBackdrop({super.key, this.origin = const Alignment(0.72, -0.85)});

  @override
  State<LightRaysBackdrop> createState() => _LightRaysBackdropState();
}

class _LightRaysBackdropState extends State<LightRaysBackdrop>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 18),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (reduceMotion) {
      _controller.stop();
      _controller.value = 0.25;
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final dark = context.isDarkMode;

    return IgnorePointer(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) => CustomPaint(
          size: Size.infinite,
          painter: _LightRaysPainter(
            t: _controller.value,
            accent: brandGreen,
            ring: c.border,
            intensity: dark ? 1.0 : 0.42,
          ),
        ),
      ),
    );
  }
}

class _LightRaysPainter extends CustomPainter {
  final double t;
  final Color accent;
  final Color ring;
  final double intensity;

  _LightRaysPainter({
    required this.t,
    required this.accent,
    required this.ring,
    required this.intensity,
  });

  static const _rayCount = 11;

  @override
  void paint(Canvas canvas, Size size) {
    final origin = Offset(size.width * 0.78, size.height * 0.1);
    final reach = size.height * 1.9;

    canvas.saveLayer(Offset.zero & size, Paint());

    for (var i = 0; i < _rayCount; i++) {
      final seed = i / _rayCount;
      final drift = math.sin((t * 2 * math.pi) + seed * 6.283) * 0.055;
      final angle = math.pi * 0.52 + seed * math.pi * 0.62 + drift;
      final spread = 0.016 + 0.02 * (0.5 + 0.5 * math.sin(seed * 9.1));
      final pulse =
          0.35 + 0.65 * (0.5 + 0.5 * math.sin((t * 2 * math.pi) * 1.6 + seed * 4.1));
      final alpha = (0.012 + 0.026 * pulse) * intensity;

      final path = Path()
        ..moveTo(origin.dx, origin.dy)
        ..lineTo(
          origin.dx + math.cos(angle - spread) * reach,
          origin.dy + math.sin(angle - spread) * reach,
        )
        ..lineTo(
          origin.dx + math.cos(angle + spread) * reach,
          origin.dy + math.sin(angle + spread) * reach,
        )
        ..close();

      final shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          accent.withValues(alpha: alpha),
          accent.withValues(alpha: 0),
        ],
      ).createShader(
        Rect.fromPoints(origin, Offset(origin.dx, origin.dy + reach * 0.8)),
      );

      canvas.drawPath(
        path,
        Paint()
          ..shader = shader
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 26),
      );
    }

    canvas.restore();

    final ringPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    for (var i = 1; i <= 8; i++) {
      final radius = size.width * 0.11 * i;
      final fade = (1 - i / 9).clamp(0.0, 1.0);
      ringPaint.color = ring.withValues(alpha: 0.42 * fade * intensity);
      canvas.drawCircle(origin, radius, ringPaint);
    }

    final glowRadius = size.width * 0.5;
    canvas.drawRect(
      Offset.zero & size,
      Paint()
        ..shader = RadialGradient(
          colors: [
            accent.withValues(alpha: 0.10 * intensity),
            accent.withValues(alpha: 0),
          ],
        ).createShader(Rect.fromCircle(center: origin, radius: glowRadius)),
    );

    final orbitPhase = t * 2 * math.pi;
    for (var i = 0; i < 3; i++) {
      final radius = size.width * 0.11 * (i * 2 + 3);
      final a = orbitPhase * (i.isEven ? 1 : -1) + i * 2.1;
      final p = Offset(
        origin.dx + math.cos(a) * radius,
        origin.dy + math.sin(a) * radius,
      );
      canvas.drawCircle(
        p,
        2.6,
        Paint()..color = accent.withValues(alpha: 0.6 * intensity),
      );
      canvas.drawCircle(
        p,
        10,
        Paint()
          ..color = accent.withValues(alpha: 0.16 * intensity)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _LightRaysPainter old) =>
      old.t != t || old.accent != accent || old.intensity != intensity;
}
