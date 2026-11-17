import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { Router } from '@angular/router';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { ConfigService } from '../../services/config.service';
import { matchesPlatformFilter } from '../../utils/ignore-platform.util';
import {
  BreakdownHolding,
  BreakdownLayout,
  BreakdownLevel,
  LayoutNode,
  BreakdownUnit,
  buildBreakdownLayout,
  formatBreakdownAmount,
  levelLabel
} from './portfolio-breakdown.util';

type OrderPreset = {
  id: string;
  label: string;
  levels: BreakdownLevel[];
};

@Component({
  selector: 'app-portfolio-breakdown',
  templateUrl: './portfolio-breakdown.component.html',
  styleUrls: ['./portfolio-breakdown.component.css'],
  standalone: false
})
export class PortfolioBreakdownComponent implements OnInit, OnChanges {
  @Input() holdings: BreakdownHolding[] = [];
  @Input() platforms: string[] = [];
  @Input() types: string[] = [];
  @Input() subTypes: string[] = [];
  @Input() categories: string[] = [];
  @Input() minAmount: number | null = null;
  @Input() maxAmount: number | null = null;
  @Input() ignoreZero = false;
  @Input() loading = false;

  readonly orders: OrderPreset[] = [
    { id: 'sketch', label: 'Platform → Type → Sub type → Category', levels: ['platform', 'type', 'subType', 'category'] },
    { id: 'type-first', label: 'Type → Platform → Sub type → Category', levels: ['type', 'platform', 'subType', 'category'] },
    { id: 'type-tree', label: 'Type → Sub type → Category', levels: ['type', 'subType', 'category'] },
    { id: 'platform-type', label: 'Platform → Type', levels: ['platform', 'type'] }
  ];

  orderId = 'sketch';
  depth = 2;
  topN = 8;
  minPct = 0;
  unit: BreakdownUnit = 'lakh';
  search = '';
  hideZeroAmounts = true;
  focusPath: string[] = [];
  showChartFilters = true;

  layout: BreakdownLayout | null = null;
  ready = false;
  private ignorePlatforms: string[] = [];

  barData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  barOptions: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => {
            const row = this.layout?.childRows[context.dataIndex];
            const value = typeof context.parsed.x === 'number' ? context.parsed.x : 0;
            if (!row) {
              return formatBreakdownAmount(value, 'rupee');
            }
            return `${formatBreakdownAmount(value, 'rupee')} · ${row.pctOfParent.toFixed(1)}% of this branch · ${row.count} holdings`;
          }
        }
      }
    },
    scales: {
      x: {
        beginAtZero: true,
        ticks: {
          callback: (value) => formatBreakdownAmount(Number(value), this.unit)
        }
      },
      y: {
        ticks: {
          autoSkip: false,
          font: { size: 11 }
        }
      }
    }
  };

  constructor(
    private configService: ConfigService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.configService.ensureLoaded().subscribe((platforms) => {
      this.ignorePlatforms = platforms || [];
      this.ready = true;
      this.rebuild();
    });
  }

  ngOnChanges(_changes: SimpleChanges): void {
    if (this.ready) this.rebuild();
  }

  get currentOrder(): OrderPreset {
    return this.orders.find((order) => order.id === this.orderId) || this.orders[0];
  }

  get depthChoices(): number[] {
    const remaining = this.currentOrder.levels.length - this.focusPath.length;
    const count = Math.max(1, remaining);
    return Array.from({ length: count }, (_, index) => index + 1);
  }

  get depthSelection(): number {
    const max = this.depthChoices[this.depthChoices.length - 1] || 1;
    return Math.min(this.depth, max);
  }

  set depthSelection(value: number) {
    this.depth = Number(value) || 1;
    this.rebuild();
  }

  depthLabel(depth: number): string {
    const start = Math.min(this.focusPath.length, this.currentOrder.levels.length);
    const names = this.currentOrder.levels.slice(start, start + depth).map((level) => levelLabel(level));
    return names.length ? names.join(' → ') : 'Last level';
  }

  get portfolioSummary(): string {
    if (!this.layout) return '';
    return `${formatBreakdownAmount(this.layout.portfolioAmount, this.unit)} · ${this.layout.holdingCount} holdings`;
  }

  get ariaLabel(): string {
    if (!this.layout) return 'Portfolio breakdown';
    return `Portfolio breakdown, ${formatBreakdownAmount(this.layout.portfolioAmount, this.unit)} across ${this.layout.holdingCount} holdings`;
  }

  get barHeight(): number {
    const rows = this.layout?.childRows.length || 0;
    return Math.max(220, rows * 36 + 48);
  }

  onOrderChange(): void {
    this.focusPath = [];
    if (this.depth > this.currentOrder.levels.length) {
      this.depth = this.currentOrder.levels.length;
    }
    this.rebuild();
  }

  onChartFilterChange(): void {
    this.rebuild();
  }

  toggleChartFilters(): void {
    this.showChartFilters = !this.showChartFilters;
  }

  resetChartFilters(): void {
    this.orderId = 'sketch';
    this.depth = 2;
    this.topN = 8;
    this.minPct = 0;
    this.unit = 'lakh';
    this.search = '';
    this.hideZeroAmounts = true;
    this.focusPath = [];
    this.rebuild();
  }

  clearFocus(): void {
    this.focusPath = [];
    this.rebuild();
  }

  focusTo(index: number): void {
    this.focusPath = this.focusPath.slice(0, index + 1);
    this.rebuild();
  }

  onNodeClick(node: LayoutNode): void {
    if (node.level === 'portfolio') return;
    const selected = {
      platform: [...(this.platforms || [])],
      type: [...(this.types || [])],
      subType: [...(this.subTypes || [])],
      category: [...(this.categories || [])]
    };
    node.path.forEach((label, index) => {
      const level = this.currentOrder.levels[index];
      if (!level) return;
      selected[this.paramKey(level)] = [label];
    });
    if (node.collapsedOthers) {
      selected[this.paramKey(node.level)] = [...node.members];
    }
    const queryParams: Record<string, string> = {};
    (Object.keys(selected) as Array<keyof typeof selected>).forEach((key) => {
      const values = selected[key].map((value) => value === 'Unspecified' ? '__blank__' : value).filter((value) => value.length);
      if (values.length) queryParams[key] = values.join('|');
    });
    if (this.hideZeroAmounts || this.ignoreZero) queryParams['ignoreZero'] = '1';
    if (this.minAmount !== null && this.minAmount !== undefined && !Number.isNaN(this.minAmount)) {
      queryParams['min'] = String(this.minAmount);
    }
    if (this.maxAmount !== null && this.maxAmount !== undefined && !Number.isNaN(this.maxAmount)) {
      queryParams['max'] = String(this.maxAmount);
    }
    this.router.navigate(['/investments'], { queryParams });
  }

  onNodeKey(event: Event, node: LayoutNode): void {
    event.preventDefault();
    this.onNodeClick(node);
  }

  private paramKey(level: BreakdownLevel): 'platform' | 'type' | 'subType' | 'category' {
    if (level === 'platform') return 'platform';
    if (level === 'type') return 'type';
    if (level === 'subType') return 'subType';
    return 'category';
  }

  private rebuild(): void {
    const rows = this.filteredHoldings();
    const layout = buildBreakdownLayout({
      rows,
      levels: this.currentOrder.levels,
      depth: this.depth,
      topN: this.topN,
      minPct: this.minPct,
      unit: this.unit,
      search: this.search,
      focusPath: this.focusPath
    });
    if (layout.appliedFocus.join('\u0001') !== this.focusPath.join('\u0001')) {
      this.focusPath = layout.appliedFocus;
    }
    this.layout = layout;
    const palette = [
      'rgba(74, 124, 155, 0.85)',
      'rgba(61, 139, 110, 0.85)',
      'rgba(184, 134, 11, 0.85)',
      'rgba(109, 91, 138, 0.85)',
      'rgba(196, 92, 92, 0.85)',
      'rgba(59, 111, 143, 0.85)',
      'rgba(14, 165, 233, 0.75)',
      'rgba(100, 116, 139, 0.75)'
    ];
    this.barData = {
      labels: layout.childRows.map((row) => row.label),
      datasets: [{
        label: 'Amount',
        data: layout.childRows.map((row) => row.amount),
        backgroundColor: layout.childRows.map((_, index) => palette[index % palette.length]),
        borderWidth: 0,
        borderRadius: 4
      }]
    };
  }

  private filteredHoldings(): BreakdownHolding[] {
    return (this.holdings || []).filter((row) => {
      if (!matchesPlatformFilter(row.website_app_name, this.platforms || [], this.ignorePlatforms)) {
        return false;
      }
      if (this.types?.length && !this.types.includes(String(row.investment_type || ''))) return false;
      if (this.subTypes?.length && !this.subTypes.includes(String(row.sub_type_name || ''))) return false;
      if (this.categories?.length && !this.categories.includes(String(row.sub_type_category || ''))) return false;
      const amount = typeof row.amount === 'number' ? row.amount : parseFloat(String(row.amount ?? '0')) || 0;
      if ((this.ignoreZero || this.hideZeroAmounts) && amount === 0) return false;
      if (this.minAmount !== null && this.minAmount !== undefined && !Number.isNaN(this.minAmount) && amount < this.minAmount) {
        return false;
      }
      if (this.maxAmount !== null && this.maxAmount !== undefined && !Number.isNaN(this.maxAmount) && amount > this.maxAmount) {
        return false;
      }
      return true;
    });
  }
}
