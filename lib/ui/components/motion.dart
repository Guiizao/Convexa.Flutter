import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';

const _fast = Duration(milliseconds: 180);
const _medium = Duration(milliseconds: 320);

bool _reduced(BuildContext context) =>
    MediaQuery.maybeDisableAnimationsOf(context) ?? false;

/// Troca de aba com fade curto e deslocamento mínimo. Nada de slide longo:
/// o painel precisa parecer instantâneo, não coreografado.
class ScreenTransition extends StatelessWidget {
  final int index;
  final Widget child;

  const ScreenTransition({super.key, required this.index, required this.child});

  @override
  Widget build(BuildContext context) {
    if (_reduced(context)) return child;
    return AnimatedSwitcher(
      duration: _fast,
      switchInCurve: Curves.easeOut,
      switchOutCurve: Curves.easeIn,
      transitionBuilder: (widget, animation) => FadeTransition(
        opacity: animation,
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0, 0.012),
            end: Offset.zero,
          ).animate(animation),
          child: widget,
        ),
      ),
      layoutBuilder: (current, previous) => Stack(
        alignment: Alignment.topCenter,
        children: [...previous, if (current != null) current],
      ),
      child: KeyedSubtree(key: ValueKey(index), child: child),
    );
  }
}

/// Entrada escalonada de listas. `position` é o índice do item.
class StaggeredEntrance extends StatelessWidget {
  final int position;
  final Widget child;

  const StaggeredEntrance({
    super.key,
    required this.position,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    if (_reduced(context)) return child;
    final delayed = (position.clamp(0, 8)) * 45;
    return TweenAnimationBuilder<double>(
      key: ValueKey('stagger-$position'),
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: 260 + delayed),
      curve: Curves.easeOutCubic,
      builder: (context, t, widget) => Opacity(
        opacity: t.clamp(0.0, 1.0),
        child: Transform.translate(offset: Offset(0, 8 * (1 - t)), child: widget),
      ),
      child: child,
    );
  }
}

/// Número que sobe até o valor final. Usado nos KPIs — o formatador recebe o
/// valor inteiro já interpolado, então serve para dinheiro e para contagem.
class CountUp extends StatelessWidget {
  final num value;
  final String Function(num) format;
  final TextStyle style;

  const CountUp({
    super.key,
    required this.value,
    required this.format,
    required this.style,
  });

  @override
  Widget build(BuildContext context) {
    if (_reduced(context)) return Text(format(value), style: style);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: value.toDouble()),
      duration: _medium,
      curve: Curves.easeOutCubic,
      builder: (context, v, _) => Text(format(v), style: style),
    );
  }
}

/// Bloco cinza pulsante para o estado de carregamento, no lugar de deixar a
/// tela em branco enquanto a API responde.
class Skeleton extends StatefulWidget {
  final double? width;
  final double height;
  final double radius;

  const Skeleton({
    super.key,
    this.width,
    this.height = 14,
    this.radius = Radii.sm,
  });

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1100),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_reduced(context)) {
      _controller.value = 0.5;
    } else if (!_controller.isAnimating) {
      _controller.repeat(reverse: true);
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
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) => Container(
        width: widget.width,
        height: widget.height,
        decoration: BoxDecoration(
          color: Color.lerp(c.surf, c.surfHover, _controller.value),
          borderRadius: BorderRadius.circular(widget.radius),
        ),
      ),
    );
  }
}

class SkeletonRow extends StatelessWidget {
  const SkeletonRow({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.all(Space.md),
      margin: const EdgeInsets.only(bottom: Space.sm),
      decoration: BoxDecoration(
        color: c.surf,
        borderRadius: BorderRadius.circular(Radii.md),
        border: Border.all(color: c.border),
      ),
      child: const Row(
        children: [
          Skeleton(width: 40, height: 32),
          SizedBox(width: Space.md),
          Skeleton(width: 34, height: 34, radius: Radii.pill),
          SizedBox(width: Space.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Skeleton(width: 140, height: 12),
                SizedBox(height: 7),
                Skeleton(width: 90, height: 10),
              ],
            ),
          ),
          Skeleton(width: 62, height: 14),
        ],
      ),
    );
  }
}

class SkeletonList extends StatelessWidget {
  final int count;
  const SkeletonList({super.key, this.count = 4});

  @override
  Widget build(BuildContext context) => Column(
        children: List.generate(count, (_) => const SkeletonRow()),
      );
}
