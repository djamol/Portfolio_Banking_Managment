import { Component, OnInit } from '@angular/core';
import { InvestmentService } from '../../services/investment.service';
import { MutualFundNavSnapshot, MutualFundService } from '../../services/mutual-fund.service';
import { ChartConfiguration } from 'chart.js';

@Component({
  selector: 'app-mutual-fund-history',
  templateUrl: './mutual-fund-history.component.html',
  styleUrls: ['./mutual-fund-history.component.css'],
  standalone: false
})
export class MutualFundHistoryComponent implements OnInit {
  investments: any[] = [];
  visibleInvestments: any[] = [];
  snapshots: MutualFundNavSnapshot[] = [];
  selectedIds = new Set<number>();
  search = '';
  showOnlyMissing = false;
  aggregateRows: Array<{ date: string; funds: number; units: number; value: number }> = [];
  period: 'daily' | 'weekly' | 'monthly' = 'daily';
  view: 'chart' | 'table' = 'chart';
  chartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  from = this.toYmd(new Date(new Date().setFullYear(new Date().getFullYear() - 1)));
  to = this.toYmd(new Date());
  loading = false;
  saving = false;
  error = '';
  message = '';
  get selectedCount(): number { return this.selectedIds.size; }
  get allVisibleSelected(): boolean { return this.visibleInvestments.length > 0 && this.visibleInvestments.every(row => this.selectedIds.has(row.id)); }
  get detailedSnapshots(): Array<MutualFundNavSnapshot & { investment: any }> {
    return this.snapshots.map(row => ({
      ...row,
      investment: this.investments.find(item => item.id === row.investment_id) || {}
    }));
  }

  constructor(
    private investmentService: InvestmentService,
    private mutualFundService: MutualFundService
  ) {}

  ngOnInit() {
    this.investmentService.getAll().subscribe({
      next: rows => {
        this.investments = (rows || []).filter(row =>
          row.investment_type === 'Mutual Fund'
          && row.mutual_fund_scheme_code
          && Number(row.units) > 0
        );
        this.applyFundFilter();
      },
      error: error => this.error = error?.message || 'Unable to load mutual funds'
    });
  }

  applyFundFilter() {
    const query = this.search.trim().toLowerCase();
    this.visibleInvestments = this.investments.filter(row => {
      const matchesSearch = !query || `${row.website_app_name} ${row.sub_type_name} ${row.mutual_fund_scheme_name} ${row.sub_type_category} ${row.mutual_fund_scheme_code}`.toLowerCase().includes(query);
      const hasHistory = Boolean(row.history_count);
      return matchesSearch && (!this.showOnlyMissing || !hasHistory);
    });
  }

  toggleFund(id: number) {
    this.selectedIds.has(id) ? this.selectedIds.delete(id) : this.selectedIds.add(id);
    this.selectedIds = new Set(this.selectedIds);
  }

  toggleAllVisible() {
    const next = new Set(this.selectedIds);
    if (this.allVisibleSelected) this.visibleInvestments.forEach(row => next.delete(row.id));
    else this.visibleInvestments.forEach(row => next.add(row.id));
    this.selectedIds = next;
  }

  clearSelection() { this.selectedIds = new Set(); }

  loadSnapshots() {
    const ids = [...this.selectedIds];
    if (!ids.length || !this.from || !this.to) { this.snapshots = []; this.aggregateRows = []; return; }
    this.loading = true;
    let pending = ids.length;
    const all: MutualFundNavSnapshot[] = [];
    ids.forEach(id => this.mutualFundService.getSnapshots(id, this.from, this.to).subscribe({
      next: rows => { all.push(...rows); if (!--pending) this.finishSnapshotLoad(all); },
      error: error => { this.error = error?.error?.error || 'Unable to load NAV snapshots'; if (!--pending) this.finishSnapshotLoad(all); }
    }));
  }

  private finishSnapshotLoad(rows: MutualFundNavSnapshot[]) {
    this.snapshots = rows.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    const grouped = new Map<string, { funds: number; units: number; value: number }>();
    for (const row of this.snapshots) {
      const current = grouped.get(row.snapshot_date) || { funds: 0, units: 0, value: 0 };
      current.funds += 1; current.units += Number(row.units) || 0; current.value += Number(row.value) || 0;
      grouped.set(row.snapshot_date, current);
    }
    this.aggregateRows = [...grouped.entries()].map(([date, data]) => ({ date, ...data }));
    this.refreshPeriodView();
    this.loading = false;
  }

  setPeriod(period: 'daily' | 'weekly' | 'monthly') {
    this.period = period;
    this.refreshPeriodView();
  }

  setView(view: 'chart' | 'table') { this.view = view; }

  private refreshPeriodView() {
    const grouped = new Map<string, { funds: Set<number>; units: number; value: number }>();
    for (const row of this.snapshots) {
      const key = this.periodKey(row.snapshot_date);
      const current = grouped.get(key) || { funds: new Set<number>(), units: 0, value: 0 };
      current.funds.add(row.investment_id);
      current.units += Number(row.units) || 0;
      current.value += Number(row.value) || 0;
      grouped.set(key, current);
    }
    this.aggregateRows = [...grouped.entries()].map(([date, data]) => ({
      date, funds: data.funds.size, units: data.units, value: data.value
    }));
    const datasets: any[] = [{
      label: `MFAPI value (${this.period})`,
      data: this.aggregateRows.map(row => row.value),
      borderColor: '#2563eb',
      backgroundColor: 'rgba(37, 99, 235, .12)',
      fill: true,
      tension: .25,
      pointRadius: this.period === 'daily' ? 1 : 3,
      yAxisID: 'value'
    }];
    const colors = ['#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#e11d48', '#84cc16', '#f97316'];
    [...this.selectedIds].slice(0, 8).forEach((id, index) => {
      const investment = this.investments.find(item => item.id === id);
      const byPeriod = new Map<string, number>();
      this.snapshots.filter(item => item.investment_id === id).forEach(item => {
        const key = this.periodKey(item.snapshot_date);
        byPeriod.set(key, (byPeriod.get(key) || 0) + Number(item.value || 0));
      });
      datasets.push({
        label: this.fundLabel(investment),
        data: this.aggregateRows.map(row => byPeriod.get(row.date) ?? null),
        borderColor: colors[index % colors.length],
        backgroundColor: 'transparent',
        tension: .25,
        pointRadius: this.period === 'daily' ? 1 : 2,
        yAxisID: 'value'
      });
    });
    this.chartData = {
      labels: this.aggregateRows.map(row => row.date),
      datasets
    };
  }

  private periodKey(value: string): string {
    if (this.period === 'daily') return value;
    const date = new Date(`${value}T00:00:00`);
    if (this.period === 'monthly') return value.slice(0, 7);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return this.toYmd(date);
  }

  fetchAndSave() {
    if (!this.selectedIds.size || !this.from || !this.to || this.from > this.to) return;
    this.saving = true;
    this.error = '';
    this.message = '';
    const dates: string[] = [];
    const cursor = new Date(`${this.from}T00:00:00`);
    const end = new Date(`${this.to}T00:00:00`);
    while (cursor <= end) {
      dates.push(this.toYmd(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    let pending = this.selectedIds.size;
    let saved = 0;
    this.selectedIds.forEach(id => this.mutualFundService.saveSnapshots(id, dates).subscribe({
      next: rows => { saved += rows.length; if (!--pending) { this.message = `${saved} NAV snapshots saved across ${this.selectedIds.size} funds`; this.saving = false; this.loadSnapshots(); } },
      error: error => { this.error = error?.error?.error || 'Unable to fetch NAV history'; if (!--pending) this.saving = false; }
    }));
  }

  format(value: number): string {
    return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  fundLabel(investment: any): string {
    if (!investment) return 'Unknown fund';
    return [investment.mutual_fund_scheme_name, investment.sub_type_category].filter(Boolean).join(' · ')
      || investment.mutual_fund_scheme_code || `Investment ${investment.id}`;
  }

  formatChartTick(value: string | number): string {
    const amount = Number(value) || 0;
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} L`;
    return `₹${Math.round(amount).toLocaleString('en-IN')}`;
  }

  private toYmd(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}
