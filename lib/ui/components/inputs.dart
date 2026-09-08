import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/formatters.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';

class AppTextField extends StatelessWidget {
  final String label;
  final TextEditingController controller;
  final String? hint;
  final String? helper;
  final String? error;
  final bool obscure;
  final IconData? icon;
  final Widget? suffix;
  final TextInputType keyboardType;
  final List<TextInputFormatter>? formatters;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;
  final bool enabled;

  const AppTextField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.helper,
    this.error,
    this.obscure = false,
    this.icon,
    this.suffix,
    this.keyboardType = TextInputType.text,
    this.formatters,
    this.onChanged,
    this.onSubmitted,
    this.autofocus = false,
    this.enabled = true,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final hasError = error != null && error!.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppType.caption.copyWith(color: c.t2)),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          obscureText: obscure,
          enabled: enabled,
          autofocus: autofocus,
          keyboardType: keyboardType,
          inputFormatters: formatters,
          onChanged: onChanged,
          onSubmitted: onSubmitted,
          style: AppType.body.copyWith(color: c.t1),
          cursorColor: c.primary,
          cursorWidth: 1.5,
          decoration: InputDecoration(
            isDense: true,
            filled: true,
            fillColor: c.surf,
            hintText: hint,
            hintStyle: AppType.body.copyWith(color: c.t3),
            prefixIcon: icon == null
                ? null
                : Padding(
                    padding: const EdgeInsets.only(left: 12, right: 8),
                    child: Icon(icon, size: 16, color: c.t2),
                  ),
            prefixIconConstraints:
                const BoxConstraints(minWidth: 0, minHeight: 0),
            suffixIcon: suffix,
            contentPadding: const EdgeInsets.symmetric(
                horizontal: Space.md, vertical: 13),
            border: _border(hasError ? c.red : c.border),
            enabledBorder: _border(hasError ? c.red : c.border),
            focusedBorder: _border(hasError ? c.red : c.primary, width: 1.5),
            disabledBorder: _border(c.border),
          ),
        ),
        if (hasError) ...[
          const SizedBox(height: 5),
          Text(error!, style: AppType.caption.copyWith(color: c.red)),
        ] else if (helper != null) ...[
          const SizedBox(height: 5),
          Text(helper!, style: AppType.caption.copyWith(color: c.t2)),
        ],
      ],
    );
  }

  OutlineInputBorder _border(Color color, {double width = 1}) =>
      OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.md),
        borderSide: BorderSide(color: color, width: width),
      );
}

class SegmentedControl<T> extends StatelessWidget {
  final List<({T value, String label, IconData? icon})> options;
  final T selected;
  final ValueChanged<T> onChanged;
  final bool expand;

  const SegmentedControl({
    super.key,
    required this.options,
    required this.selected,
    required this.onChanged,
    this.expand = false,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final row = Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      children: options.map((option) {
        final active = option.value == selected;
        final content = AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(
              horizontal: Space.md, vertical: 8),
          decoration: BoxDecoration(
            color: active ? c.card : Colors.transparent,
            borderRadius: BorderRadius.circular(Radii.sm),
            border: Border.all(
                color: active ? c.borderStrong : Colors.transparent),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (option.icon != null) ...[
                Icon(option.icon,
                    size: 13, color: active ? c.t1 : c.t2),
                const SizedBox(width: 6),
              ],
              Text(
                option.label,
                style: AppType.caption.copyWith(
                  color: active ? c.t1 : c.t2,
                  fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                ),
              ),
            ],
          ),
        );
        final tappable = MouseRegion(
          cursor: SystemMouseCursors.click,
          child: GestureDetector(
            onTap: () => onChanged(option.value),
            child: content,
          ),
        );
        return expand ? Expanded(child: tappable) : tappable;
      }).toList(),
    );

    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: c.surf,
        borderRadius: BorderRadius.circular(Radii.md),
        border: Border.all(color: c.border),
      ),
      child: row,
    );
  }
}

class TimePickerField extends StatelessWidget {
  final String label;
  final int minutes;
  final ValueChanged<int> onChanged;
  final int stepMinutes;
  final int minMinutes;
  final int maxMinutes;

  const TimePickerField({
    super.key,
    required this.label,
    required this.minutes,
    required this.onChanged,
    this.stepMinutes = 30,
    this.minMinutes = 0,
    this.maxMinutes = 24 * 60,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppType.caption.copyWith(color: c.t2)),
        const SizedBox(height: 6),
        Container(
          height: 44,
          decoration: BoxDecoration(
            color: c.surf,
            borderRadius: BorderRadius.circular(Radii.md),
            border: Border.all(color: c.border),
          ),
          child: Row(
            children: [
              _StepButton(
                icon: Icons.remove_rounded,
                onTap: minutes - stepMinutes >= minMinutes
                    ? () => onChanged(minutes - stepMinutes)
                    : null,
              ),
              Expanded(
                child: Center(
                  child: Text(
                    formatMinutesAsClock(minutes),
                    style: AppType.numericSm.copyWith(color: c.t1),
                  ),
                ),
              ),
              _StepButton(
                icon: Icons.add_rounded,
                onTap: minutes + stepMinutes <= maxMinutes
                    ? () => onChanged(minutes + stepMinutes)
                    : null,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _StepButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;
  const _StepButton({required this.icon, this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return MouseRegion(
      cursor: onTap == null ? SystemMouseCursors.basic : SystemMouseCursors.click,
      child: GestureDetector(
        onTap: onTap,
        child: SizedBox(
          width: 40,
          height: 42,
          child: Icon(
            icon,
            size: 16,
            color: onTap == null ? c.t3 : c.t2,
          ),
        ),
      ),
    );
  }
}

class NumberStepper extends StatelessWidget {
  final String label;
  final int value;
  final String suffix;
  final int step;
  final int min;
  final int max;
  final ValueChanged<int> onChanged;

  const NumberStepper({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.suffix = '',
    this.step = 1,
    this.min = 0,
    this.max = 999,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppType.caption.copyWith(color: c.t2)),
        const SizedBox(height: 6),
        Container(
          height: 44,
          decoration: BoxDecoration(
            color: c.surf,
            borderRadius: BorderRadius.circular(Radii.md),
            border: Border.all(color: c.border),
          ),
          child: Row(
            children: [
              _StepButton(
                icon: Icons.remove_rounded,
                onTap: value - step >= min ? () => onChanged(value - step) : null,
              ),
              Expanded(
                child: Center(
                  child: Text(
                    '$value$suffix',
                    style: AppType.numericSm.copyWith(color: c.t1),
                  ),
                ),
              ),
              _StepButton(
                icon: Icons.add_rounded,
                onTap: value + step <= max ? () => onChanged(value + step) : null,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class AppSelect<T> extends StatelessWidget {
  final String label;
  final T value;
  final List<({T value, String label})> options;
  final ValueChanged<T?> onChanged;

  const AppSelect({
    super.key,
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppType.caption.copyWith(color: c.t2)),
        const SizedBox(height: 6),
        Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: Space.md),
          decoration: BoxDecoration(
            color: c.surf,
            borderRadius: BorderRadius.circular(Radii.md),
            border: Border.all(color: c.border),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<T>(
              value: value,
              isExpanded: true,
              dropdownColor: c.card,
              borderRadius: BorderRadius.circular(Radii.md),
              icon: Icon(Icons.keyboard_arrow_down_rounded, size: 18, color: c.t2),
              style: AppType.body.copyWith(color: c.t1),
              onChanged: onChanged,
              items: options
                  .map((o) => DropdownMenuItem<T>(
                        value: o.value,
                        child: Text(o.label, style: AppType.body.copyWith(color: c.t1)),
                      ))
                  .toList(),
            ),
          ),
        ),
      ],
    );
  }
}
