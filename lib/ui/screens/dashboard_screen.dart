import 'package:flutter/material.dart';

import '../../core/date_utils.dart';
import '../../core/formatters.dart';
import '../../core/responsive.dart';
import '../../state/app_state.dart';
import '../../theme/app_theme.dart';
import '../../theme/tokens.dart';
import '../components/buttons.dart';
import '../components/charts.dart';
import '../components/primitives.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final m = state.metrics;
    final now = DateTime.now();

    if (m.isEmpty) {
      return AppCard(
        child: EmptyState(
          icon: Icons.insights_outlined,
          title: 'Ainda sem histórico',
          message:
              'Os números aparecem aqui assim que o primeiro mês de atendimentos for registrado. Nada é estimado ou inventado.',
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: SectionHeader(
                title: monthYearLabel(now),
                subtitle:
                    'Comparado com ${monthYearLabel(DateTime(now.year, now.month - 1))}.',
                padding: EdgeInsets.zero,
              ),
            ),
            AppButton(
              label: 'Exportar',
              icon: Icons.download_outlined,
              variant: ButtonVariant.secondary,
              size: ButtonSize.small,
              // API: GET /api/metrics/export?month=YYYY-MM devolve o CSV/PDF
              // consolidado para contabilidade. Ainda não implementado.
              onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Exportação será ligada ao endpoint de relatórios.'),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: Space.lg),
        ResponsiveGrid(
          minItemWidth: 210,
          children: [
            MetricTile(
              label: 'Clientes atendidos',
              value: '${m.customersCount}',
              icon: Icons.people_outline_rounded,
              delta: m.customersDelta == 0
                  ? null
                  : '${m.customersDelta > 0 ? '+' : ''}${m.customersDelta} vs mês anterior',
              deltaPositive: m.customersDelta >= 0,
            ),
            MetricTile(
              label: 'Receita do mês',
              value: formatCurrencyCompact(m.revenueCents),
              icon: Icons.payments_outlined,
              delta: m.revenueDeltaPercent == 0
                  ? null
                  : '${m.revenueDeltaPercent > 0 ? '+' : ''}${m.revenueDeltaPercent}%',
              deltaPositive: m.revenueDeltaPercent >= 0,
            ),
            MetricTile(
              label: 'Ticket médio',
              value: formatCurrency(m.averageTicketCents),
              icon: Icons.receipt_long_outlined,
            ),
            MetricTile(
              label: 'Faltas e cancelamentos',
              value: '${m.noShowCount + m.cancellationsCount}',
              icon: Icons.event_busy_outlined,
              delta: '${m.noShowCount} faltas · ${m.cancellationsCount} cancel.',
              deltaPositive: false,
            ),
          ],
        ),
        const SizedBox(height: Space.lg),
        Responsive.isDesktop(context)
            ? Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(flex: 7, child: _RevenueCard()),
                  const SizedBox(width: Space.lg),
                  Expanded(flex: 4, child: _ServicesCard()),
                ],
              )
            : Column(
                children: [
                  _RevenueCard(),
                  const SizedBox(height: Space.lg),
                  _ServicesCard(),
                ],
              ),
        const SizedBox(height: Space.lg),
        _AbsenteeismCard(),
      ],
    );
  }
}

class _RevenueCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final m = AppScope.of(context).metrics;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Expanded(
                child: SectionHeader(
                  title: 'Receita por semana',
                  subtitle: 'Mês atual contra o anterior.',
                  padding: EdgeInsets.zero,
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  _LegendDot(color: c.t3, label: 'Anterior'),
                  const SizedBox(height: 5),
                  _LegendDot(color: c.primary, label: 'Atual'),
                ],
              ),
            ],
          ),
          const SizedBox(height: Space.xl),
          GroupedBarChart(
            data: m.revenueByWeek,
            previousColor: c.t3,
            currentColor: c.primary,
          ),
        ],
      ),
    );
  }
}

class _LegendDot extends StatelessWidget {
  final Color color;
  final String label;
  const _LegendDot({required this.color, required this.label});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 7,
          height: 7,
          decoration:
              BoxDecoration(color: color, borderRadius: BorderRadius.circular(2)),
        ),
        const SizedBox(width: 6),
        Text(label, style: AppType.caption.copyWith(color: c.t2)),
      ],
    );
  }
}

class _ServicesCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final m = AppScope.of(context).metrics;
    final total = m.serviceShares.fold<int>(0, (s, i) => s + i.count);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            title: 'Serviços mais pedidos',
            subtitle: 'Onde está a demanda real do mês.',
          ),
          Center(
            child: DonutChart(
              data: m.serviceShares,
              centerValue: '$total',
              centerLabel: 'atendimentos',
            ),
          ),
          const SizedBox(height: Space.xl),
          ChartLegend(
            items: [
              for (var i = 0; i < m.serviceShares.length; i++)
                (
                  label: m.serviceShares[i].name,
                  value: '${m.serviceShares[i].percent.toStringAsFixed(1)}%',
                  color: DonutChart.palette[i % DonutChart.palette.length],
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AbsenteeismCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final state = AppScope.of(context);
    final m = state.metrics;
    final settings = state.settings;

    final totalBooked = m.customersCount + m.noShowCount + m.cancellationsCount;
    final rate = totalBooked == 0 ? 0.0 : m.noShowCount / totalBooked;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            title: 'Absenteísmo',
            subtitle: 'Quanto do faturamento previsto se perde em faltas.',
          ),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${(rate * 100).toStringAsFixed(1)}%',
                      style: AppType.numeric.copyWith(
                        color: rate > 0.1 ? c.amber : c.t1,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${m.noShowCount} de $totalBooked horários marcados viraram falta.',
                      style: AppType.small.copyWith(color: c.t2),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: Space.lg),
          ProgressBar(value: rate, color: rate > 0.1 ? c.amber : c.primary),
          const SizedBox(height: Space.xl),
          if (!settings.prepaymentEnabled)
            InfoBanner(
              tone: BannerTone.info,
              message:
                  'O pagamento antecipado com desconto está desligado. Ligar essa opção em Configurações costuma ser a forma mais direta de reduzir faltas.',
            )
          else
            InfoBanner(
              tone: BannerTone.success,
              message:
                  'Pagamento antecipado ativo com ${settings.prepaymentDiscountPercent}% de desconto para quem confirma na hora do agendamento.',
            ),
        ],
      ),
    );
  }
}
