import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/formatters.dart';
import '../../models/models.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';

class GroupedBarChart extends StatelessWidget {
  final List<PeriodRevenue> data;
  final Color previousColor;
  final Color currentColor;
  final double height;

  const GroupedBarChart({
    super.key,
    required this.data,
    required this.previousColor,
    required this.currentColor,
    this.height = 190,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    if (data.isEmpty) return SizedBox(height: height);

    final maxValue = data
        .expand((d) => [d.previousCents, d.currentCents])
        .fold<int>(0, math.max)
        .toDouble();
    final safeMax = maxValue <= 0 ? 1.0 : maxValue;

    return SizedBox(
      height: height,
      child: LayoutBuilder(
        builder: (context, constraints) {
          const labelHeight = 24.0;
          final plotHeight = constraints.maxHeight - labelHeight;
          return Stack(
            children: [
              Positioned.fill(
                bottom: labelHeight,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: List.generate(
                    4,
                    (_) => Container(height: 1, color: c.border),
                  ),
                ),
              ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: data.map((entry) {
                  return Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        SizedBox(
                          height: plotHeight,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              _Bar(
                                height: entry.previousCents / safeMax * plotHeight,
                                color: previousColor,
                                tooltip:
                                    'Anterior · ${formatCurrency(entry.previousCents)}',
                              ),
                              const SizedBox(width: 6),
                              _Bar(
                                height: entry.currentCents / safeMax * plotHeight,
                                color: currentColor,
                                tooltip:
                                    'Atual · ${formatCurrency(entry.currentCents)}',
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          entry.label,
                          style: AppType.caption.copyWith(color: c.t2),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  );
                }).toList(),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _Bar extends StatelessWidget {
  final double height;
  final Color color;
  final String tooltip;

  const _Bar({required this.height, required this.color, required this.tooltip});

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: height.clamp(2.0, double.infinity)),
        duration: const Duration(milliseconds: 450),
        curve: Curves.easeOutCubic,
        builder: (context, value, _) => Container(
          width: 16,
          height: value,
          decoration: BoxDecoration(
            color: color,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
          ),
        ),
      ),
    );
  }
}

class DonutChart extends StatelessWidget {
  final List<ServiceShare> data;
  final double size;
  final double stroke;
  final String? centerLabel;
  final String? centerValue;

  const DonutChart({
    super.key,
    required this.data,
    this.size = 148,
    this.stroke = 20,
    this.centerLabel,
    this.centerValue,
  });

  static const palette = [
    Color(0xFF00C795),
    Color(0xFF4C8DFF),
    Color(0xFFE0973A),
    Color(0xFFB57BFF),
    Color(0xFFEC6A8C),
  ];

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: 1),
            duration: const Duration(milliseconds: 600),
            curve: Curves.easeOutCubic,
            builder: (context, progress, _) => CustomPaint(
              size: Size.square(size),
              painter: _DonutPainter(
                data: data,
                stroke: stroke,
                progress: progress,
                trackColor: c.surf,
              ),
            ),
          ),
          if (centerValue != null)
            Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(centerValue!,
                    style: AppType.h1.copyWith(color: c.t1)),
                if (centerLabel != null)
                  Text(centerLabel!,
                      style: AppType.caption.copyWith(color: c.t2)),
              ],
            ),
        ],
      ),
    );
  }
}

class _DonutPainter extends CustomPainter {
  final List<ServiceShare> data;
  final double stroke;
  final double progress;
  final Color trackColor;

  _DonutPainter({
    required this.data,
    required this.stroke,
    required this.progress,
    required this.trackColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromCircle(
      center: Offset(size.width / 2, size.height / 2),
      radius: (math.min(size.width, size.height) - stroke) / 2,
    );

    canvas.drawArc(
      rect,
      0,
      2 * math.pi,
      false,
      Paint()
        ..color = trackColor
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke,
    );

    final total = data.fold<double>(0, (sum, d) => sum + d.percent);
    if (total <= 0) return;

    const gap = 0.045;
    var start = -math.pi / 2;
    for (var i = 0; i < data.length; i++) {
      final fraction = data[i].percent / total;
      final sweep = (fraction * 2 * math.pi - gap) * progress;
      if (sweep <= 0) continue;
      canvas.drawArc(
        rect,
        start + gap / 2,
        sweep,
        false,
        Paint()
          ..color = DonutChart.palette[i % DonutChart.palette.length]
          ..style = PaintingStyle.stroke
          ..strokeWidth = stroke
          ..strokeCap = StrokeCap.butt,
      );
      start += fraction * 2 * math.pi;
    }
  }

  @override
  bool shouldRepaint(covariant _DonutPainter old) =>
      old.progress != progress || old.data != data;
}

class ChartLegend extends StatelessWidget {
  final List<({String label, String value, Color color})> items;

  const ChartLegend({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Column(
      children: items
          .map((item) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: item.color,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    const SizedBox(width: Space.md),
                    Expanded(
                      child: Text(
                        item.label,
                        style: AppType.small.copyWith(color: c.t2),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Text(
                      item.value,
                      style: AppType.small.copyWith(
                        color: c.t1,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ))
          .toList(),
    );
  }
}

class ProgressBar extends StatelessWidget {
  final double value;
  final Color? color;
  final double height;

  const ProgressBar({
    super.key,
    required this.value,
    this.color,
    this.height = 6,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return ClipRRect(
      borderRadius: BorderRadius.circular(Radii.pill),
      child: Stack(
        children: [
          Container(height: height, color: c.surf),
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: value.clamp(0.0, 1.0)),
            duration: const Duration(milliseconds: 500),
            curve: Curves.easeOutCubic,
            builder: (context, animated, _) => FractionallySizedBox(
              widthFactor: animated,
              child: Container(height: height, color: color ?? c.primary),
            ),
          ),
        ],
      ),
    );
  }
}

class DayTimeline extends StatelessWidget {
  final int startMinutes;
  final int endMinutes;
  final int nowMinutes;
  final List<({int start, int end, Color color, String label})> blocks;

  const DayTimeline({
    super.key,
    required this.startMinutes,
    required this.endMinutes,
    required this.nowMinutes,
    required this.blocks,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final span = (endMinutes - startMinutes).clamp(1, 24 * 60);

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        double xFor(int minutes) =>
            ((minutes - startMinutes) / span * width).clamp(0.0, width);

        return SizedBox(
          height: 46,
          child: Stack(
            children: [
              Positioned(
                left: 0,
                right: 0,
                top: 10,
                child: Container(
                  height: 14,
                  decoration: BoxDecoration(
                    color: c.surf,
                    borderRadius: BorderRadius.circular(Radii.sm),
                    border: Border.all(color: c.border),
                  ),
                ),
              ),
              ...blocks.map((block) {
                final left = xFor(block.start);
                final right = xFor(block.end);
                return Positioned(
                  left: left,
                  top: 10,
                  width: math.max(right - left, 3),
                  height: 14,
                  child: Tooltip(
                    message: block.label,
                    child: Container(
                      decoration: BoxDecoration(
                        color: block.color,
                        borderRadius: BorderRadius.circular(Radii.sm),
                      ),
                    ),
                  ),
                );
              }),
              if (nowMinutes >= startMinutes && nowMinutes <= endMinutes)
                Positioned(
                  left: xFor(nowMinutes) - 1,
                  top: 4,
                  child: Container(
                    width: 2,
                    height: 26,
                    decoration: BoxDecoration(
                      color: c.red,
                      borderRadius: BorderRadius.circular(1),
                    ),
                  ),
                ),
              Positioned(
                left: 0,
                bottom: 0,
                child: Text(formatMinutesAsClock(startMinutes),
                    style: AppType.caption.copyWith(color: c.t2)),
              ),
              Positioned(
                right: 0,
                bottom: 0,
                child: Text(formatMinutesAsClock(endMinutes),
                    style: AppType.caption.copyWith(color: c.t2)),
              ),
            ],
          ),
        );
      },
    );
  }
}
