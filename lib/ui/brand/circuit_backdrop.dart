import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import 'logo.dart';

/// Fundo animado do login: trilhas ortogonais estilo placa de circuito com um
/// risco de luz correndo por algumas delas. Mesma linguagem visual do site de
/// apresentação, para painel e site não parecerem produtos diferentes.
///
/// A luz é extraída do próprio caminho com PathMetric, então ela acompanha as
/// curvas em vez de ser uma bolinha desenhada por cima.
class CircuitBackdrop extends StatefulWidget {
  /// Reduz densidade e brilho quando o fundo fica atrás do formulário inteiro,
  /// como acontece no celular.
  final bool subdued;

  const CircuitBackdrop({super.key, this.subdued = false});

  @override
  State<CircuitBackdrop> createState() => _CircuitBackdropState();
}

class _CircuitBackdropState extends State<CircuitBackdrop>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 24),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (reduceMotion) {
      _controller.stop();
      _controller.value = 0.3;
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
    final dark = context.isDarkMode;

    // Verde vivo brilha no escuro; no claro ele some no fundo quase branco, e
    // um verde escuro funciona como sombra.
    final accent = dark ? brandGreen : const Color(0xFF0E6B34);
    final base = widget.subdued ? 0.55 : 1.0;

    return IgnorePointer(
      child: RepaintBoundary(
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) => CustomPaint(
            size: Size.infinite,
            painter: _CircuitPainter(
              t: _controller.value,
              accent: accent,
              trace: dark
                  ? accent.withValues(alpha: 0.085 * base)
                  : accent.withValues(alpha: 0.16 * base),
              node: dark
                  ? accent.withValues(alpha: 0.22 * base)
                  : accent.withValues(alpha: 0.3 * base),
              glowStrength: (dark ? 1.0 : 0.75) * base,
              dense: !widget.subdued,
            ),
          ),
        ),
      ),
    );
  }
}

class _Trace {
  final Path path;
  final double length;
  final double phase;
  final double speed;

  _Trace(this.path, this.length, this.phase, this.speed);
}

class _CircuitPainter extends CustomPainter {
  final double t;
  final Color accent;
  final Color trace;
  final Color node;
  final double glowStrength;
  final bool dense;

  _CircuitPainter({
    required this.t,
    required this.accent,
    required this.trace,
    required this.node,
    required this.glowStrength,
    required this.dense,
  });

  static const _streak = 58.0;
  static const _rest = 220.0;

  Size? _builtFor;
  List<_Trace> _traces = const [];
  List<Offset> _nodes = const [];
  List<_Trace> _lit = const [];

  void _build(Size size) {
    if (_builtFor == size) return;
    _builtFor = size;

    final rand = math.Random(7);
    final spacing = size.width < 620 ? 96.0 : 132.0;
    final cols = (size.width / spacing).ceil() + 2;
    final rows = (size.height / spacing).ceil() + 2;

    final grid = List.generate(
      rows,
      (r) => List.generate(cols, (col) {
        final jitter = spacing * 0.24;
        return Offset(
          col * spacing + (rand.nextDouble() - 0.5) * jitter,
          r * spacing + (rand.nextDouble() - 0.5) * jitter,
        );
      }),
    );

    _nodes = [for (final row in grid) ...row];

    final built = <_Trace>[];
    for (var r = 0; r < rows; r++) {
      for (var col = 0; col < cols; col++) {
        final p = grid[r][col];
        final targets = <Offset>[];
        if (col < cols - 1 && rand.nextDouble() > 0.34) targets.add(grid[r][col + 1]);
        if (r < rows - 1 && rand.nextDouble() > 0.52) targets.add(grid[r + 1][col]);

        for (final n in targets) {
          final bend =
              rand.nextBool() ? Offset(n.dx, p.dy) : Offset(p.dx, n.dy);
          final path = Path()
            ..moveTo(p.dx, p.dy)
            ..lineTo(bend.dx, bend.dy)
            ..lineTo(n.dx, n.dy);
          final length = (bend - p).distance + (n - bend).distance;
          if (length < 2) continue;
          built.add(_Trace(
            path,
            length,
            rand.nextDouble(),
            0.055 + rand.nextDouble() * 0.06,
          ));
        }
      }
    }

    _traces = built;

    // Sorteia as trilhas acesas por toda a tela, em vez de pegar as primeiras
    // da lista — que ficariam todas no canto superior esquerdo.
    final indices = List.generate(built.length, (i) => i)..shuffle(rand);
    final howMany = math.min(built.length, dense ? 18 : 9);
    _lit = [for (final i in indices.take(howMany)) built[i]];
  }

  @override
  void paint(Canvas canvas, Size size) {
    _build(size);

    final tracePaint = Paint()
      ..color = trace
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    for (final tr in _traces) {
      canvas.drawPath(tr.path, tracePaint);
    }

    final nodePaint = Paint()..color = node;
    for (final n in _nodes) {
      canvas.drawCircle(n, 1.5, nodePaint);
    }

    final elapsed = t * 24000;

    for (final tr in _lit) {
      final cycle = tr.length + _streak + _rest;
      final travelled = (elapsed * tr.speed + tr.phase * cycle) % cycle;
      final head = travelled - _streak;
      final tail = head - _streak;
      if (head <= 0 || tail >= tr.length) continue;

      final from = tail.clamp(0.0, tr.length);
      final to = head.clamp(0.0, tr.length);
      if (to - from < 0.5) continue;

      for (final metric in tr.path.computeMetrics()) {
        if (from > metric.length) continue;
        final segment = metric.extractPath(from, math.min(to, metric.length));

        canvas.drawPath(
          segment,
          Paint()
            ..color = accent.withValues(
                alpha: (0.34 * glowStrength).clamp(0.0, 1.0).toDouble())
            ..style = PaintingStyle.stroke
            ..strokeWidth = 3.4
            ..strokeCap = StrokeCap.round
            ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5),
        );
        canvas.drawPath(
          segment,
          Paint()
            ..color = accent.withValues(
                alpha: (0.95 * glowStrength).clamp(0.0, 1.0).toDouble())
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.4
            ..strokeCap = StrokeCap.round,
        );

        final tip = metric.getTangentForOffset(math.min(to, metric.length));
        if (tip != null) {
          canvas.drawCircle(
            tip.position,
            2.4,
            Paint()
              ..color = accent.withValues(
                  alpha: (0.9 * glowStrength).clamp(0.0, 1.0).toDouble())
              ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3),
          );
        }
        break;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _CircuitPainter old) =>
      old.t != t || old.accent != accent || old.glowStrength != glowStrength;
}

/// Véu suave sobre as trilhas, para o texto do formulário não competir com o
/// fundo. Mais forte onde o conteúdo fica.
class BackdropScrim extends StatelessWidget {
  final Alignment begin;
  final Alignment end;

  const BackdropScrim({
    super.key,
    this.begin = Alignment.bottomLeft,
    this.end = Alignment.topRight,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return IgnorePointer(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: begin,
            end: end,
            colors: [
              c.bg.withValues(alpha: 0.9),
              c.bg.withValues(alpha: 0.15),
            ],
          ),
        ),
        child: const SizedBox.expand(),
      ),
    );
  }
}
