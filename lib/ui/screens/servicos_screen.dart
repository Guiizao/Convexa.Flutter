import 'package:flutter/material.dart';

import '../../core/formatters.dart';
import '../../core/responsive.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';
import '../components/buttons.dart';
import '../components/inputs.dart';
import '../components/primitives.dart';

class ServicosScreen extends StatefulWidget {
  const ServicosScreen({super.key});

  @override
  State<ServicosScreen> createState() => _ServicosScreenState();
}

class _ServicosScreenState extends State<ServicosScreen> {
  String _query = '';
  bool _onlyActive = false;

  Future<void> _edit([ServiceItem? service]) async {
    await showDialog<void>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.55),
      builder: (_) => ServiceEditorDialog(service: service),
    );
  }

  Future<void> _confirmDelete(ServiceItem service) async {
    final c = context.colors;
    final confirmed = await showDialog<bool>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.55),
      builder: (dialogContext) => Dialog(
        backgroundColor: Colors.transparent,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
          child: AppCard(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Remover "${service.name}"?',
                    style: AppType.h2.copyWith(color: c.t1)),
                const SizedBox(height: Space.sm),
                Text(
                  'O agente deixa de oferecer este serviço no WhatsApp. Agendamentos já marcados não são afetados.',
                  style: AppType.small.copyWith(color: c.t2, height: 1.55),
                ),
                const SizedBox(height: Space.xl),
                Row(
                  children: [
                    Expanded(
                      child: AppButton(
                        label: 'Manter',
                        variant: ButtonVariant.secondary,
                        expand: true,
                        onPressed: () =>
                            Navigator.of(dialogContext).pop(false),
                      ),
                    ),
                    const SizedBox(width: Space.md),
                    Expanded(
                      child: AppButton(
                        label: 'Remover',
                        variant: ButtonVariant.danger,
                        expand: true,
                        onPressed: () => Navigator.of(dialogContext).pop(true),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );

    if (confirmed != true || !mounted) return;
    final error = await AppScope.read(context).deleteService(service.id);
    if (error != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);

    var services = state.serviceList;
    if (_onlyActive) services = services.where((s) => s.active).toList();
    if (_query.isNotEmpty) {
      final q = _query.toLowerCase();
      services =
          services.where((s) => s.name.toLowerCase().contains(q)).toList();
    }

    final activeCount = state.serviceList.where((s) => s.active).length;
    final averagePrice = state.serviceList.isEmpty
        ? 0
        : state.serviceList.fold<int>(0, (s, i) => s + i.priceCents) ~/
            state.serviceList.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ResponsiveGrid(
          minItemWidth: 200,
          children: [
            MetricTile(
              label: 'Serviços cadastrados',
              value: '${state.serviceList.length}',
              icon: Icons.list_alt_outlined,
            ),
            MetricTile(
              label: 'Ativos no WhatsApp',
              value: '$activeCount',
              icon: Icons.chat_bubble_outline_rounded,
            ),
            MetricTile(
              label: 'Preço médio',
              value: formatCurrency(averagePrice),
              icon: Icons.payments_outlined,
            ),
          ],
        ),
        const SizedBox(height: Space.lg),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Expanded(
                    child: SectionHeader(
                      title: 'Catálogo de serviços',
                      subtitle:
                          'É esta lista que o agente usa para oferecer, precificar e calcular a duração de cada horário.',
                      padding: EdgeInsets.zero,
                    ),
                  ),
                  const SizedBox(width: Space.md),
                  AppButton(
                    label: 'Novo serviço',
                    icon: Icons.add_rounded,
                    onPressed: () => _edit(),
                  ),
                ],
              ),
              const SizedBox(height: Space.lg),
              Row(
                children: [
                  Expanded(
                    child: SizedBox(
                      height: 42,
                      child: TextField(
                        onChanged: (v) => setState(() => _query = v),
                        style: AppType.body.copyWith(color: c.t1),
                        cursorColor: c.primary,
                        decoration: InputDecoration(
                          isDense: true,
                          filled: true,
                          fillColor: c.surf,
                          hintText: 'Buscar serviço',
                          hintStyle: AppType.body.copyWith(color: c.t3),
                          prefixIcon:
                              Icon(Icons.search_rounded, size: 17, color: c.t2),
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: Space.md, vertical: 12),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(Radii.md),
                            borderSide: BorderSide(color: c.border),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(Radii.md),
                            borderSide: BorderSide(color: c.border),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(Radii.md),
                            borderSide: BorderSide(color: c.primary, width: 1.5),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: Space.md),
                  SegmentedControl<bool>(
                    selected: _onlyActive,
                    onChanged: (v) => setState(() => _onlyActive = v),
                    options: const [
                      (value: false, label: 'Todos', icon: null),
                      (value: true, label: 'Só ativos', icon: null),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: Space.lg),
              if (state.serviceList.isEmpty)
                EmptyState(
                  icon: Icons.content_cut_outlined,
                  title: 'Nenhum serviço cadastrado',
                  message:
                      'Cadastre o primeiro serviço com nome, duração e preço. O agente só consegue agendar o que estiver aqui.',
                  action: AppButton(
                    label: 'Cadastrar serviço',
                    icon: Icons.add_rounded,
                    onPressed: () => _edit(),
                  ),
                )
              else if (services.isEmpty)
                EmptyState(
                  icon: Icons.search_off_rounded,
                  title: 'Nada encontrado',
                  message: 'Nenhum serviço corresponde a esse filtro.',
                )
              else
                ...services.map((service) => Padding(
                      padding: const EdgeInsets.only(bottom: Space.sm),
                      child: _ServiceRow(
                        service: service,
                        onEdit: () => _edit(service),
                        onDelete: () => _confirmDelete(service),
                      ),
                    )),
            ],
          ),
        ),
      ],
    );
  }
}

class _ServiceRow extends StatelessWidget {
  final ServiceItem service;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _ServiceRow({
    required this.service,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final compact = Responsive.isMobile(context);

    return Container(
      padding: const EdgeInsets.all(Space.md),
      decoration: BoxDecoration(
        color: c.surf,
        borderRadius: BorderRadius.circular(Radii.md),
        border: Border.all(color: c.border),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: service.active ? c.primaryWash : c.card,
              borderRadius: BorderRadius.circular(Radii.sm),
            ),
            child: Icon(
              Icons.content_cut_rounded,
              size: 16,
              color: service.active ? c.primaryText : c.t3,
            ),
          ),
          const SizedBox(width: Space.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  service.name,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.bodyStrong.copyWith(
                    color: service.active ? c.t1 : c.t2,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  '${formatDuration(service.durationMinutes)} · ${formatCurrency(service.priceCents)}',
                  style: AppType.caption.copyWith(color: c.t2),
                ),
              ],
            ),
          ),
          if (!compact) ...[
            StatusBadge(
              service.active ? 'Ativo' : 'Pausado',
              tone: service.active ? BadgeTone.success : BadgeTone.neutral,
            ),
            const SizedBox(width: Space.md),
          ],
          AppSwitch(
            value: service.active,
            onChanged: (v) =>
                state.saveService(service.copyWith(active: v)),
          ),
          const SizedBox(width: Space.sm),
          AppIconButton(
            icon: Icons.edit_outlined,
            size: 34,
            tooltip: 'Editar',
            onPressed: onEdit,
          ),
          const SizedBox(width: 6),
          AppIconButton(
            icon: Icons.delete_outline_rounded,
            size: 34,
            tooltip: 'Remover',
            onPressed: onDelete,
          ),
        ],
      ),
    );
  }
}

class ServiceEditorDialog extends StatefulWidget {
  final ServiceItem? service;
  const ServiceEditorDialog({super.key, this.service});

  @override
  State<ServiceEditorDialog> createState() => _ServiceEditorDialogState();
}

class _ServiceEditorDialogState extends State<ServiceEditorDialog> {
  late final TextEditingController _name;
  late final TextEditingController _price;
  late int _duration;
  late bool _active;
  bool _saving = false;
  String? _nameError;
  String? _priceError;

  @override
  void initState() {
    super.initState();
    final s = widget.service;
    _name = TextEditingController(text: s?.name ?? '');
    _price = TextEditingController(
      text: s == null ? '' : formatCurrency(s.priceCents, showSymbol: false),
    );
    _duration = s?.durationMinutes ?? 30;
    _active = s?.active ?? true;
  }

  @override
  void dispose() {
    _name.dispose();
    _price.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    final cents = parseCurrencyToCents(_price.text);
    setState(() {
      _nameError = name.isEmpty ? 'Dê um nome ao serviço.' : null;
      _priceError = cents == null
          ? 'Informe um preço válido.'
          : (cents <= 0 ? 'O preço precisa ser maior que zero.' : null);
    });
    if (_nameError != null || _priceError != null) return;

    setState(() => _saving = true);
    final error = await AppScope.read(context).saveService(
      ServiceItem(
        id: widget.service?.id ?? '',
        name: name,
        durationMinutes: _duration,
        priceCents: cents!,
        active: _active,
      ),
    );
    if (!mounted) return;
    setState(() => _saving = false);
    if (error == null) {
      Navigator.of(context).pop();
    } else {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final editing = widget.service != null;

    return Dialog(
      backgroundColor: Colors.transparent,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: SingleChildScrollView(
          child: AppCard(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SectionHeader(
                  title: editing ? 'Editar serviço' : 'Novo serviço',
                  subtitle:
                      'A duração define quanto tempo o horário ocupa na agenda.',
                ),
                AppTextField(
                  label: 'Nome do serviço',
                  controller: _name,
                  hint: 'Corte masculino, barba, combo...',
                  autofocus: true,
                  error: _nameError,
                ),
                const SizedBox(height: Space.lg),
                Row(
                  children: [
                    Expanded(
                      child: AppTextField(
                        label: 'Preço',
                        controller: _price,
                        hint: '0,00',
                        icon: Icons.attach_money_rounded,
                        keyboardType: TextInputType.number,
                        error: _priceError,
                      ),
                    ),
                    const SizedBox(width: Space.md),
                    Expanded(
                      child: NumberStepper(
                        label: 'Duração',
                        value: _duration,
                        suffix: ' min',
                        step: 5,
                        min: 5,
                        max: 240,
                        onChanged: (v) => setState(() => _duration = v),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: Space.lg),
                Container(
                  padding: const EdgeInsets.all(Space.md),
                  decoration: BoxDecoration(
                    color: c.surf,
                    borderRadius: BorderRadius.circular(Radii.md),
                    border: Border.all(color: c.border),
                  ),
                  child: SettingRow(
                    title: 'Disponível no agente',
                    description:
                        'Quando desligado, o agente não oferece este serviço no WhatsApp.',
                    value: _active,
                    onChanged: (v) => setState(() => _active = v),
                  ),
                ),
                const SizedBox(height: Space.xl),
                Row(
                  children: [
                    Expanded(
                      child: AppButton(
                        label: 'Cancelar',
                        variant: ButtonVariant.secondary,
                        expand: true,
                        onPressed: () => Navigator.of(context).pop(),
                      ),
                    ),
                    const SizedBox(width: Space.md),
                    Expanded(
                      child: AppButton(
                        label: editing ? 'Salvar' : 'Cadastrar',
                        expand: true,
                        loading: _saving,
                        onPressed: _save,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
