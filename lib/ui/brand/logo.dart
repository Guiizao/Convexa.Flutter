import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

const brandGreen = Color(0xFF2BD96B);

class ConvexaMark extends StatelessWidget {
  final double size;
  final Color? color;

  const ConvexaMark({super.key, this.size = 26, this.color});

  @override
  Widget build(BuildContext context) {
    final fill = color ?? brandGreen;
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: fill, shape: BoxShape.circle),
      child: Padding(
        padding: EdgeInsets.only(bottom: size * 0.04),
        child: Text(
          'c.',
          style: TextStyle(
            color: const Color(0xFF04120B),
            fontSize: size * 0.5,
            height: 1,
            fontWeight: FontWeight.w700,
            letterSpacing: -size * 0.02,
          ),
        ),
      ),
    );
  }
}

class ConvexaLogo extends StatelessWidget {
  final double size;
  final bool showMark;

  const ConvexaLogo({super.key, this.size = 26, this.showMark = true});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (showMark) ...[
          ConvexaMark(size: size),
          SizedBox(width: size * 0.36),
        ],
        Text.rich(
          TextSpan(
            children: [
              TextSpan(
                text: 'convexa',
                style: TextStyle(
                  color: c.t1,
                  fontSize: size * 0.86,
                  height: 1,
                  fontWeight: FontWeight.w600,
                  letterSpacing: -size * 0.035,
                ),
              ),
              TextSpan(
                text: '.',
                style: TextStyle(
                  color: brandGreen,
                  fontSize: size * 0.86,
                  height: 1,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
