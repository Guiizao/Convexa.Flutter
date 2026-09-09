import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../theme/app_theme.dart';

/// Fundo animado do login: trilhas estilo placa de circuito, com percursos
/// longos em corredores, desvios de 45 graus, feixes paralelos e ilhas nas
/// pontas. Alguns percursos recebem um cometa de luz que corre até o destino.
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
  /// Tempo em milissegundos desde que a tela abriu, sempre crescendo.
  ///
  /// Um AnimationController em repeat() volta a zero no fim do ciclo, e como
  /// todos os cometas leem o mesmo relógio, todos saltavam juntos — dava para
  /// ver o vídeo reiniciando. Com um Ticker o tempo nunca retrocede, então
  /// cada percurso completa o seu próprio ciclo sem sincronizar com os outros.
  late final Ticker _ticker;
  final ValueNotifier<double> _clock = ValueNotifier<double>(0);

  @override
  void initState() {
    super.initState();
    _ticker = createTicker((elapsed) {
      _clock.value = elapsed.inMicroseconds / 1000.0;
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (reduceMotion) {
      if (_ticker.isActive) _ticker.stop();
      _clock.value = 9000;
    } else if (!_ticker.isActive) {
      _ticker.start();
    }
  }

  @override
  void dispose() {
    _ticker.dispose();
    _clock.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = context.isDarkMode;

    return IgnorePointer(
      child: RepaintBoundary(
        child: ValueListenableBuilder<double>(
          valueListenable: _clock,
          builder: (context, ms, _) => CustomPaint(
            size: Size.infinite,
            painter: _CircuitPainter(
              elapsedMs: ms,
              dark: dark,
              strength: widget.subdued ? 0.62 : 1.0,
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
  final double elapsedMs;
  final bool dark;
  final double strength;
  final bool dense;

  _CircuitPainter({
    required this.elapsedMs,
    required this.dark,
    required this.strength,
    required this.dense,
  });

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

  static const _streak = 150.0;
  static const _rest = 180.0;
  static const _slices = 18;

  /// Passo do corredor. Tudo se alinha a este passo — é o alinhamento que
  /// separa "placa de circuito" de "rabisco".
  static const _pitch = 26.0;

  List<Color> get _palette => dark ? _greensDark : _greensLight;

  Size? _builtFor;
  List<_Trace> _traces = const [];
  List<_Pad> _pads = const [];
  List<_Trace> _lit = const [];

  /// Um percurso é uma sequência de trechos retos ligados por desvios de 45
  /// graus, sempre sobre a malha de corredores. Nada de posição aleatória:
  /// o roteamento anterior ligava vizinhos ao acaso e o resultado era ruído.
  static List<Offset> _routeAlongLanes(
    math.Random rand,
    Offset start,
    bool horizontal,
    int legs,
  ) {
    final pts = <Offset>[start];
    var cur = start;
    var goingHorizontal = horizontal;
    var sx = rand.nextBool() ? 1.0 : -1.0;
    var sy = rand.nextBool() ? 1.0 : -1.0;

    for (var i = 0; i < legs; i++) {
      // Trecho reto, sempre múltiplo do passo.
      final run = _pitch * (2 + rand.nextInt(5));
      cur = goingHorizontal
          ? cur.translate(sx * run, 0)
          : cur.translate(0, sy * run);
      pts.add(cur);

      // Desvio de 45 graus para o corredor vizinho.
      if (i < legs - 1) {
        final jog = _pitch * (1 + rand.nextInt(2));
        if (goingHorizontal) {
          sy = rand.nextBool() ? 1.0 : -1.0;
          cur = cur.translate(sx * jog, sy * jog);
        } else {
          sx = rand.nextBool() ? 1.0 : -1.0;
          cur = cur.translate(sx * jog, sy * jog);
        }
        pts.add(cur);
        // Mantém a direção na maior parte das vezes: alternar sempre deixa
        // o desenho nervoso, e placa real tem corridas longas.
        if (rand.nextDouble() > 0.72) goingHorizontal = !goingHorizontal;
      }
    }
    return pts;
  }

  static Path _pathOf(List<Offset> pts) {
    final p = Path()..moveTo(pts.first.dx, pts.first.dy);
    for (var i = 1; i < pts.length; i++) {
      p.lineTo(pts[i].dx, pts[i].dy);
    }
    return p;
  }

  static double _lengthOf(List<Offset> pts) {
    var total = 0.0;
    for (var i = 1; i < pts.length; i++) {
      total += (pts[i] - pts[i - 1]).distance;
    }
    return total;
  }

  static List<Offset> _offsetRoute(List<Offset> pts, double gap) =>
      [for (final p in pts) p.translate(0, gap)];

  void _build(Size size) {
    if (_builtFor == size) return;
    _builtFor = size;

    final rand = math.Random(23);
    final traces = <_Trace>[];
    final pads = <_Pad>[];

    void add(List<Offset> pts) {
      final length = _lengthOf(pts);
      if (length < _pitch * 2) return;
      traces.add(_Trace(
        _pathOf(pts),
        length,
        rand.nextDouble(),
        0.05 + rand.nextDouble() * 0.06,
        rand.nextInt(_palette.length),
      ));
    }

    final area = size.width * size.height;
    final routeCount = (area / (dense ? 26000 : 42000)).round().clamp(10, 70);

    for (var i = 0; i < routeCount; i++) {
      // Origem sempre num cruzamento de corredores.
      final start = Offset(
        (rand.nextDouble() * size.width / _pitch).floor() * _pitch,
        (rand.nextDouble() * size.height / _pitch).floor() * _pitch,
      );
      final horizontal = rand.nextBool();
      final legs = 2 + rand.nextInt(4);
      final pts = _routeAlongLanes(rand, start, horizontal, legs);

      add(pts);

      // Feixe: trilhas paralelas ao mesmo percurso, como um barramento.
      if (rand.nextDouble() > 0.55) {
        final lanes = 1 + rand.nextInt(3);
        for (var k = 1; k <= lanes; k++) {
          add(_offsetRoute(pts, k * (_pitch / 4)));
        }
      }

      pads.add(_Pad(pts.first, rand.nextDouble() > 0.6 ? 3.0 : 2.0,
          rand.nextDouble() > 0.5));
      pads.add(_Pad(pts.last, rand.nextDouble() > 0.6 ? 3.0 : 2.0,
          rand.nextDouble() > 0.5));
    }

    // Ilhas soltas em cruzamentos, como furos de componente.
    final loose = (area / 34000).round().clamp(6, 60);
    for (var i = 0; i < loose; i++) {
      final at = Offset(
        (rand.nextDouble() * size.width / _pitch).floor() * _pitch,
        (rand.nextDouble() * size.height / _pitch).floor() * _pitch,
      );
      pads.add(_Pad(at, 2.0, rand.nextDouble() > 0.4));
    }

    _traces = traces;
    _pads = pads;

    final long = [
      for (var i = 0; i < traces.length; i++)
        if (traces[i].length > _pitch * 5) i
    ]..shuffle(rand);
    final howMany = math.min(long.length, dense ? 26 : 14);
    _lit = [for (final i in long.take(howMany)) traces[i]];
  }

  @override
  void paint(Canvas canvas, Size size) {
    _build(size);

    final traceAlpha = dark ? 0.11 : 0.2;
    final padAlpha = dark ? 0.26 : 0.34;

    final tracePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0
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
            ..strokeWidth = 1.0,
        );
      } else {
        canvas.drawCircle(pad.at, pad.radius, Paint()..color = color);
      }
    }

    final glow = dark ? _greensDark[0] : _greensLight[2];
    final core = dark ? const Color(0xFFD6FFEA) : _greensLight[0];

    for (final tr in _lit) {
      final cycle = tr.length + _streak + _rest;
      final travelled = (elapsedMs * tr.speed + tr.phase * cycle) % cycle;
      final head = travelled - _streak;
      final tail = head - _streak;
      if (head <= 0 || tail >= tr.length) continue;

      final from = tail.clamp(0.0, tr.length);
      final to = head.clamp(0.0, tr.length);
      if (to - from < 1) continue;

      // Ao chegar na ilha final a cabeça encostava no fim e ficava parada
      // enquanto a cauda alcançava — lia como travar, e depois sumia de uma
      // vez. Agora o cometa se dissolve enquanto encosta.
      final overrun = head - tr.length;
      final fade = overrun <= 0
          ? 1.0
          : (1.0 - overrun / _streak).clamp(0.0, 1.0).toDouble();
      if (fade <= 0.01) continue;

      for (final metric in tr.path.computeMetrics()) {
        if (from > metric.length) continue;
        final end = math.min(to, metric.length);
        if (end - from < 1) break;

        for (var s = 0; s < _slices; s++) {
          final f1 = (s + 1) / _slices;
          final d0 = from + (end - from) * (s / _slices);
          final d1 = from + (end - from) * f1;
          if (d1 - d0 < 0.4) continue;

          final k = f1 * f1;
          final segment = metric.extractPath(d0, d1);

          canvas.drawPath(
            segment,
            Paint()
              ..color = glow.withValues(
                  alpha: ((dark ? 0.34 : 0.46) * k * fade * strength)
                      .clamp(0.0, 1.0)
                      .toDouble())
              ..style = PaintingStyle.stroke
              ..strokeWidth = 1.6 + 4.6 * k
              ..strokeCap = StrokeCap.round
              ..strokeJoin = StrokeJoin.round
              ..maskFilter = MaskFilter.blur(BlurStyle.normal, 3 + 7 * k),
          );
          canvas.drawPath(
            segment,
            Paint()
              ..color = core.withValues(
                  alpha: ((dark ? 0.95 : 1.0) * k * fade * strength)
                      .clamp(0.0, 1.0)
                      .toDouble())
              ..style = PaintingStyle.stroke
              ..strokeWidth = 0.5 + 1.5 * k
              ..strokeCap = StrokeCap.round
              ..strokeJoin = StrokeJoin.round,
          );
        }

        final tip = metric.getTangentForOffset(end);
        if (tip != null) {
          canvas.drawCircle(
            tip.position,
            6.0,
            Paint()
              ..color = glow.withValues(
                  alpha: (0.45 * fade * strength).clamp(0.0, 1.0).toDouble())
              ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 9),
          );
          canvas.drawCircle(
            tip.position,
            2.4,
            Paint()
              ..color = core.withValues(
                  alpha: (1.0 * fade * strength).clamp(0.0, 1.0).toDouble())
              ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2),
          );
        }
        break;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _CircuitPainter old) =>
      old.elapsedMs != elapsedMs ||
      old.dark != dark ||
      old.strength != strength;
}

/// Véu sobre as trilhas para o conteúdo não competir com o fundo. Fica opaco
/// onde o texto está e transparente onde o desenho pode aparecer.
class BackdropScrim extends StatelessWidget {
  final Alignment begin;
  final Alignment end;
  final List<double> stops;
  final List<double> opacities;

  /// Padrão do desktop: opaco à direita, onde fica o formulário, e limpo à
  /// esquerda, onde o desenho pode aparecer.
  const BackdropScrim({
    super.key,
    this.begin = Alignment.centerRight,
    this.end = Alignment.centerLeft,
    this.stops = const [0.0, 0.55, 1.0],
    this.opacities = const [1.0, 0.82, 0.0],
  });

  /// No celular o formulário fica no meio da tela, então o véu é forte no
  /// centro e deixa as trilhas aparecerem em cima e embaixo.
  const BackdropScrim.centered({super.key})
      : begin = Alignment.topCenter,
        end = Alignment.bottomCenter,
        stops = const [0.0, 0.22, 0.5, 0.78, 1.0],
        opacities = const [0.15, 0.72, 0.94, 0.72, 0.15];

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return IgnorePointer(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: begin,
            end: end,
            stops: stops,
            colors: [
              for (final o in opacities) c.bg.withValues(alpha: o),
            ],
          ),
        ),
        child: const SizedBox.expand(),
      ),
    );
  }
}
