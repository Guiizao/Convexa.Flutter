import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

/// Fundo animado do login: trilhas estilo placa de circuito, com percursos em
/// 45 graus, feixes paralelos e ilhas nas pontas — como numa PCB de verdade.
/// Alguns caminhos recebem um risco de luz que corre até o destino.
///
/// A luz é extraída do próprio caminho com PathMetric, então ela acompanha as
/// diagonais em vez de ser uma bolinha desenhada por cima.
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
      duration: const Duration(seconds: 30),
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
    final base = widget.subdued ? 0.6 : 1.0;

    return IgnorePointer(
      child: RepaintBoundary(
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) => CustomPaint(
            size: Size.infinite,
            painter: _CircuitPainter(
              t: _controller.value,
              dark: dark,
              strength: base,
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
  final int tone;

  _Trace(this.path, this.length, this.phase, this.speed, this.tone);
}

class _Pad {
  final Offset at;
  final double radius;
  final bool hollow;

  _Pad(this.at, this.radius, this.hollow);
}

class _CircuitPainter extends CustomPainter {
  final double t;
  final bool dark;
  final double strength;
  final bool dense;

  _CircuitPainter({
    required this.t,
    required this.dark,
    required this.strength,
    required this.dense,
  });

  // Três verdes: o vivo da marca, um intermediário e um profundo. Misturá-los
  // evita a leitura de "tudo desenhado com a mesma caneta".
  static const _greensDark = [
    Color(0xFF2BD96B),
    Color(0xFF17A854),
    Color(0xFF0E7A3C),
  ];
  static const _greensLight = [
    Color(0xFF0E6B34),
    Color(0xFF14874A),
    Color(0xFF1FA65C),
  ];

  static const _streak = 74.0;
  static const _rest = 190.0;

  List<Color> get _palette => dark ? _greensDark : _greensLight;

  Size? _builtFor;
  List<_Trace> _traces = const [];
  List<_Pad> _pads = const [];
  List<_Trace> _lit = const [];

  static int _sign(double v) => v < 0 ? -1 : 1;

  /// Roteia como uma PCB: um trecho reto, uma diagonal de 45 graus, outro
  /// trecho reto. É isso que dá a leitura de placa em vez de grade.
  static Path _route(Offset from, Offset to, bool horizontalFirst) {
    final dx = to.dx - from.dx;
    final dy = to.dy - from.dy;
    final diag = math.min(dx.abs(), dy.abs());
    final path = Path()..moveTo(from.dx, from.dy);

    if (horizontalFirst) {
      final turn = from.dx + _sign(dx) * (dx.abs() - diag);
      path.lineTo(turn, from.dy);
      path.lineTo(turn + _sign(dx) * diag, from.dy + _sign(dy) * diag);
    } else {
      final turn = from.dy + _sign(dy) * (dy.abs() - diag);
      path.lineTo(from.dx, turn);
      path.lineTo(from.dx + _sign(dx) * diag, turn + _sign(dy) * diag);
    }
    path.lineTo(to.dx, to.dy);
    return path;
  }

  static double _lengthOf(Path path) {
    var total = 0.0;
    for (final m in path.computeMetrics()) {
      total += m.length;
    }
    return total;
  }

  void _build(Size size) {
    if (_builtFor == size) return;
    _builtFor = size;

    final rand = math.Random(11);
    final compact = size.width < 620;
    final spacing = compact ? 74.0 : 96.0;
    final cols = (size.width / spacing).ceil() + 2;
    final rows = (size.height / spacing).ceil() + 2;

    Offset nodeAt(int r, int col) {
      final jitter = spacing * 0.18;
      return Offset(
        col * spacing + (rand.nextDouble() - 0.5) * jitter,
        r * spacing + (rand.nextDouble() - 0.5) * jitter,
      );
    }

    final grid = List.generate(
      rows,
      (r) => List.generate(cols, (col) => nodeAt(r, col)),
    );

    final traces = <_Trace>[];
    final pads = <_Pad>[];

    void addTrace(Offset a, Offset b, {bool bus = false}) {
      final horizontalFirst = rand.nextBool();
      final path = _route(a, b, horizontalFirst);
      final length = _lengthOf(path);
      if (length < 8) return;
      traces.add(_Trace(
        path,
        length,
        rand.nextDouble(),
        0.05 + rand.nextDouble() * 0.07,
        rand.nextInt(_palette.length),
      ));

      // Feixe: duas ou três trilhas correndo juntas, como um barramento.
      if (bus) {
        final offsets = rand.nextBool() ? [5.0, 10.0] : [6.0];
        for (final off in offsets) {
          final shifted = _route(
            a.translate(0, off),
            b.translate(0, off),
            horizontalFirst,
          );
          traces.add(_Trace(
            shifted,
            _lengthOf(shifted),
            rand.nextDouble(),
            0.05 + rand.nextDouble() * 0.07,
            rand.nextInt(_palette.length),
          ));
        }
      }
    }

    for (var r = 0; r < rows; r++) {
      for (var col = 0; col < cols; col++) {
        final p = grid[r][col];

        if (col < cols - 1 && rand.nextDouble() > 0.42) {
          addTrace(p, grid[r][col + 1], bus: rand.nextDouble() > 0.72);
        }
        if (r < rows - 1 && rand.nextDouble() > 0.58) {
          addTrace(p, grid[r + 1][col]);
        }
        // Diagonal longa ocasional, que é o que dá o desenho de placa.
        if (r < rows - 1 && col < cols - 1 && rand.nextDouble() > 0.82) {
          addTrace(p, grid[r + 1][col + 1]);
        }

        // Ilhas: nem todo nó vira pad, e alguns são vias vazadas.
        if (rand.nextDouble() > 0.45) {
          pads.add(_Pad(
            p,
            rand.nextDouble() > 0.72 ? 3.2 : 2.0,
            rand.nextDouble() > 0.55,
          ));
        }

        // Stub curto terminando em ilha, muito comum numa PCB real.
        if (rand.nextDouble() > 0.8) {
          final len = spacing * (0.28 + rand.nextDouble() * 0.22);
          final dir = rand.nextInt(4);
          final end = switch (dir) {
            0 => p.translate(len, 0),
            1 => p.translate(-len, 0),
            2 => p.translate(0, len),
            _ => p.translate(0, -len),
          };
          final stub = Path()
            ..moveTo(p.dx, p.dy)
            ..lineTo(end.dx, end.dy);
          traces.add(_Trace(stub, len, rand.nextDouble(), 0.06,
              rand.nextInt(_palette.length)));
          pads.add(_Pad(end, 2.4, rand.nextDouble() > 0.5));
        }
      }
    }

    _traces = traces;
    _pads = pads;

    // Sorteia as trilhas acesas por toda a tela — pegar as primeiras da lista
    // deixaria a animação amontoada no canto superior esquerdo. Mais acesas do
    // que antes: com poucas, a tela parecia parada.
    final long = [
      for (var i = 0; i < traces.length; i++)
        if (traces[i].length > spacing * 0.6) i
    ]..shuffle(rand);
    final howMany = math.min(long.length, dense ? 34 : 18);
    _lit = [for (final i in long.take(howMany)) traces[i]];
  }

  @override
  void paint(Canvas canvas, Size size) {
    _build(size);

    final traceAlpha = dark ? 0.10 : 0.22;
    final padAlpha = dark ? 0.24 : 0.34;

    final tracePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.1
      ..strokeJoin = StrokeJoin.round;

    for (final tr in _traces) {
      tracePaint.color = _palette[tr.tone]
          .withValues(alpha: (traceAlpha * strength).clamp(0.0, 1.0).toDouble());
      canvas.drawPath(tr.path, tracePaint);
    }

    for (final pad in _pads) {
      final color = _palette[1]
          .withValues(alpha: (padAlpha * strength).clamp(0.0, 1.0).toDouble());
      if (pad.hollow) {
        canvas.drawCircle(
          pad.at,
          pad.radius,
          Paint()
            ..color = color
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.1,
        );
      } else {
        canvas.drawCircle(pad.at, pad.radius, Paint()..color = color);
      }
    }

    final elapsed = t * 30000;

    for (final tr in _lit) {
      final cycle = tr.length + _streak + _rest;
      final travelled = (elapsed * tr.speed + tr.phase * cycle) % cycle;
      final head = travelled - _streak;
      final tail = head - _streak;
      if (head <= 0 || tail >= tr.length) continue;

      final from = tail.clamp(0.0, tr.length);
      final to = head.clamp(0.0, tr.length);
      if (to - from < 0.5) continue;

      // No claro a luz precisa de um verde mais forte para não sumir no fundo
      // quase branco; no escuro o verde vivo já brilha sozinho.
      final glow = dark ? _greensDark[0] : _greensLight[2];
      final core = dark ? const Color(0xFFB9FFD6) : _greensLight[0];

      for (final metric in tr.path.computeMetrics()) {
        if (from > metric.length) continue;
        final end = math.min(to, metric.length);
        final segment = metric.extractPath(from, end);

        canvas.drawPath(
          segment,
          Paint()
            ..color = glow.withValues(
                alpha: ((dark ? 0.30 : 0.42) * strength)
                    .clamp(0.0, 1.0)
                    .toDouble())
            ..style = PaintingStyle.stroke
            ..strokeWidth = 4.2
            ..strokeCap = StrokeCap.round
            ..strokeJoin = StrokeJoin.round
            ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6),
        );
        canvas.drawPath(
          segment,
          Paint()
            ..color = core.withValues(
                alpha: ((dark ? 0.95 : 1.0) * strength)
                    .clamp(0.0, 1.0)
                    .toDouble())
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.5
            ..strokeCap = StrokeCap.round
            ..strokeJoin = StrokeJoin.round,
        );

        final tip = metric.getTangentForOffset(end);
        if (tip != null) {
          canvas.drawCircle(
            tip.position,
            2.8,
            Paint()
              ..color = core.withValues(
                  alpha: (0.9 * strength).clamp(0.0, 1.0).toDouble())
              ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3),
          );
        }
        break;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _CircuitPainter old) =>
      old.t != t || old.dark != dark || old.strength != strength;
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
              c.bg.withValues(alpha: 0.86),
              c.bg.withValues(alpha: 0.10),
            ],
          ),
        ),
        child: const SizedBox.expand(),
      ),
    );
  }
}
