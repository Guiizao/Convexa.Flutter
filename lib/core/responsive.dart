import 'package:flutter/widgets.dart';

enum ScreenSize { compact, medium, expanded }

class Responsive {
  static const double mediumBreakpoint = 720;
  static const double expandedBreakpoint = 1080;

  static ScreenSize sizeOf(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    if (w >= expandedBreakpoint) return ScreenSize.expanded;
    if (w >= mediumBreakpoint) return ScreenSize.medium;
    return ScreenSize.compact;
  }

  static bool isDesktop(BuildContext context) =>
      sizeOf(context) == ScreenSize.expanded;

  static bool isTablet(BuildContext context) =>
      sizeOf(context) == ScreenSize.medium;

  static bool isMobile(BuildContext context) =>
      sizeOf(context) == ScreenSize.compact;

  static bool hasSidebar(BuildContext context) =>
      MediaQuery.sizeOf(context).width >= mediumBreakpoint;

  static double width(BuildContext context) =>
      MediaQuery.sizeOf(context).width;

  static T value<T>(
    BuildContext context, {
    required T compact,
    T? medium,
    required T expanded,
  }) {
    switch (sizeOf(context)) {
      case ScreenSize.compact:
        return compact;
      case ScreenSize.medium:
        return medium ?? expanded;
      case ScreenSize.expanded:
        return expanded;
    }
  }
}
