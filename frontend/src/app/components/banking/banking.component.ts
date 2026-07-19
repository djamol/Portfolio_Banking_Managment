import { Component, OnInit } from '@angular/core';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import {
  BankAccount,
  BankBudget,
  BankingService,
  BankTransaction,
  CategoryRule
} from '../../services/banking.service';

type TabId =
  | 'overview'
  | 'accounts'
  | 'import'
  | 'transactions'
  | 'rules'
  | 'analytics'
  | 'cashflow'
  | 'interest'
  | 'insights';
type DatePreset = '1m' | '3m' | '6m' | 'ytd' | '1y' | 'all' | 'custom';
type PeriodGrain = 'month' | 'quarter' | 'year';

type PeriodRow = {
  key: string;
  label: string;
  total_debit: number;
  total_credit: number;
  net: number;
  txn_count: number;
};

@Component({
  selector: 'app-banking',
  templateUrl: './banking.component.html',
  styleUrls: ['./banking.component.css'],
  standalone: false
})
export class BankingComponent implements OnInit {
  activeTab: TabId = 'overview';
  loading = false;
  txnLoading = false;
  message = '';
  messageType: 'success' | 'error' | 'info' = 'info';

  accounts: BankAccount[] = [];
  transactions: BankTransaction[] = [];
  txnTotal = 0;
  txnTotals = { total_debit: 0, total_credit: 0, net_cashflow: 0 };
  categories: string[] = [];
  analytics: any = null;

  filterAccountId: number | '' = '';
  filterFrom = '';
  filterTo = '';
  filterCategory = '';
  filterFlow = '';
  filterQ = '';
  filterMinAmount: number | '' = '';
  filterSort = 'date_desc';
  filterLimit = Number(localStorage.getItem('bank-txn-page-size') || 100) || 100;
  filterOffset = 0;
  datePreset: DatePreset = 'all';
  jumpPage: number | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  showAccountForm = false;
  editingAccount: BankAccount | null = null;
  accountForm: Partial<BankAccount> = this.emptyAccountForm();

  importAccountId: number | '' = '';
  importBankHint = '';
  importFile: File | null = null;
  importPreview: any = null;
  importing = false;
  lastImportResult: any = null;

  selectedIds = new Set<number>();
  bulkCategory = '';
  expandedTxnId: number | null = null;
  exporting = false;
  recategorizeMode: 'auto_only' | 'uncategorized' | 'all' = 'auto_only';

  rules: CategoryRule[] = [];
  ruleForm: CategoryRule = { pattern: '', match_field: 'narration', category: '', priority: 100, is_active: 1 };
  showRuleForm = false;

  showManualTxn = false;
  manualTxn: Partial<BankTransaction> = this.emptyManualTxn();

  budgets: BankBudget[] = [];
  budgetForm: BankBudget = { category: '', amount: 0, period_month: '' };
  recurring: any[] = [];
  forecast: any = null;
  continuity: any = null;
  continuityAccountId: number | '' = '';

  readonly bankSupport = [
    { name: 'HDFC', formats: 'CSV', status: 'Full' },
    { name: 'ICICI', formats: 'XLS / XLSX', status: 'Full' },
    { name: 'DCB', formats: 'XLS / XLSX', status: 'Full' },
    { name: 'SBI', formats: 'CSV / Excel', status: 'Generic+' },
    { name: 'Axis', formats: 'CSV / Excel', status: 'Generic+' },
    { name: 'Kotak', formats: 'CSV / Excel', status: 'Full' }
  ];

  categoryChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  expenseChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  monthlyChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  periodChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  periodNetChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  interestChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  netChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  balanceChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };

  cashflowGrain: PeriodGrain = 'month';
  periodRows: PeriodRow[] = [];
  periodBest: PeriodRow | null = null;
  periodWorst: PeriodRow | null = null;

  chartColors = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#ec4899', '#22c55e', '#a855f7', '#64748b'
  ];

  doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right' },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const value = Number(ctx.parsed) || 0;
            return `${ctx.label}: ₹${value.toLocaleString('en-IN')}`;
          }
        }
      }
    }
  };

  barOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' } },
    scales: {
      y: {
        ticks: { callback: (v) => '₹' + Number(v).toLocaleString('en-IN') }
      }
    }
  };

  lineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: {
        ticks: { callback: (v) => '₹' + Number(v).toLocaleString('en-IN') }
      }
    }
  };

  netLineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: true, position: 'top' } },
    scales: {
      y: {
        ticks: { callback: (v) => '₹' + Number(v).toLocaleString('en-IN') }
      }
    }
  };

  readonly bankOptions = ['HDFC', 'ICICI', 'DCB', 'SBI', 'Axis', 'Kotak', 'Other'];
  readonly pageSizeOptions = [50, 100, 200, 500];
  readonly sortOptions = [
    { value: 'date_desc', label: 'Newest first' },
    { value: 'date_asc', label: 'Oldest first' },
    { value: 'debit_desc', label: 'Largest debit' },
    { value: 'debit_asc', label: 'Smallest debit' },
    { value: 'credit_desc', label: 'Largest credit' },
    { value: 'credit_asc', label: 'Smallest credit' },
    { value: 'amount_desc', label: 'Largest amount' },
    { value: 'amount_asc', label: 'Smallest amount' },
    { value: 'balance_desc', label: 'Balance high → low' },
    { value: 'balance_asc', label: 'Balance low → high' },
    { value: 'account_asc', label: 'Account A→Z' },
    { value: 'account_desc', label: 'Account Z→A' },
    { value: 'category_asc', label: 'Category A→Z' },
    { value: 'category_desc', label: 'Category Z→A' },
    { value: 'narration_asc', label: 'Narration A→Z' },
    { value: 'narration_desc', label: 'Narration Z→A' }
  ];
  readonly sortableColumns: Array<{ key: string; label: string; class?: string }> = [
    { key: 'date', label: 'Date' },
    { key: 'account', label: 'Account' },
    { key: 'narration', label: 'Narration' },
    { key: 'withdrawal', label: 'Withdrawal', class: 'num' },
    { key: 'deposit', label: 'Deposit', class: 'num' },
    { key: 'balance', label: 'Balance', class: 'num' },
    { key: 'category', label: 'Category' }
  ];
  private readonly columnSortKey: Record<string, string> = {
    date: 'date',
    account: 'account',
    narration: 'narration',
    withdrawal: 'debit',
    deposit: 'credit',
    balance: 'balance',
    category: 'category'
  };
  readonly defaultCategories = [
    'Interest Income',
    'TDS / Tax',
    'Fixed Deposit',
    'Salary / Income',
    'UPI',
    'ATM / Cash',
    'Card Payment',
    'Bill Payment',
    'Recharge',
    'Shopping / Online',
    'Investment / Broker',
    'Transfer In',
    'Transfer Out',
    'Cheque',
    'Bank Charges',
    'PayPal / International',
    'Income / Credit',
    'Expense / Debit',
    'Uncategorized'
  ];

  constructor(private bankingService: BankingService) {}

  ngOnInit() {
    this.refreshAll();
  }

  get currentPage(): number {
    return Math.floor(this.filterOffset / this.filterLimit) + 1;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.txnTotal / this.filterLimit));
  }

  get pageFrom(): number {
    if (!this.txnTotal) return 0;
    return this.filterOffset + 1;
  }

  get pageTo(): number {
    return Math.min(this.filterOffset + this.transactions.length, this.txnTotal);
  }

  get sortColumn(): string {
    const base = this.filterSort.replace(/_(asc|desc)$/, '');
    if (base === 'debit') return 'withdrawal';
    if (base === 'credit') return 'deposit';
    return base || 'date';
  }

  get sortDir(): 'asc' | 'desc' {
    return this.filterSort.endsWith('_asc') ? 'asc' : 'desc';
  }

  get selectedSummary(): { count: number; debit: number; credit: number } {
    let debit = 0;
    let credit = 0;
    for (const t of this.transactions) {
      if (!this.selectedIds.has(t.id)) continue;
      debit += Number(t.withdrawal) || 0;
      credit += Number(t.deposit) || 0;
    }
    return { count: this.selectedIds.size, debit, credit };
  }

  emptyAccountForm(): Partial<BankAccount> {
    return {
      bank_name: 'HDFC',
      account_name: '',
      account_number: '',
      ifsc: '',
      account_type: 'Savings',
      currency: 'INR',
      opening_balance: 0,
      notes: '',
      is_active: 1
    };
  }

  emptyManualTxn(): Partial<BankTransaction> {
    return {
      account_id: undefined,
      txn_date: this.toIsoDate(new Date()),
      narration: '',
      withdrawal: 0,
      deposit: 0,
      category: '',
      tags: '',
      notes: ''
    };
  }

  get activeAccounts(): BankAccount[] {
    return this.accounts.filter((a) => a.is_active !== 0 && a.is_active !== false);
  }

  get filterAccounts(): BankAccount[] {
    return this.accounts;
  }

  setTab(tab: TabId) {
    this.activeTab = tab;
    if (tab === 'transactions') this.loadTransactions();
    if (tab === 'analytics' || tab === 'overview' || tab === 'cashflow' || tab === 'interest') {
      this.loadAnalytics();
    }
    if (tab === 'rules') this.loadRules();
    if (tab === 'insights') this.loadInsights();
    if (tab === 'overview') this.loadBudgets();
  }

  refreshAll() {
    this.loading = true;
    this.message = '';
    let pending = 4;
    const done = () => {
      pending -= 1;
      if (pending <= 0) this.loading = false;
    };

    this.bankingService.getAccounts().subscribe({
      next: (rows) => {
        this.accounts = rows;
        if (!this.importAccountId && this.activeAccounts.length) {
          this.importAccountId = this.activeAccounts[0].id;
        }
        done();
      },
      error: (err) => {
        this.flash('error', err.message || 'Failed to load accounts');
        done();
      }
    });

    this.bankingService.getCategories().subscribe({
      next: (cats) => {
        this.categories = [...new Set([...this.defaultCategories, ...cats])].sort();
        done();
      },
      error: () => done()
    });

    this.loadRules(done);
    this.loadAnalytics(done);
    if (this.activeTab === 'transactions') this.loadTransactions();
    if (this.activeTab === 'insights') this.loadInsights();
    this.loadBudgets();
  }

  private buildTxnFilters(forExport = false): Record<string, any> {
    const filters: Record<string, any> = {
      limit: forExport ? 5000 : this.filterLimit,
      offset: forExport ? 0 : this.filterOffset,
      sort: this.filterSort
    };
    if (this.filterAccountId) filters['account_id'] = this.filterAccountId;
    if (this.filterFrom) filters['from'] = this.filterFrom;
    if (this.filterTo) filters['to'] = this.filterTo;
    if (this.filterCategory) filters['category'] = this.filterCategory;
    if (this.filterFlow) filters['flow'] = this.filterFlow;
    if (this.filterQ) filters['q'] = this.filterQ;
    if (this.filterMinAmount) filters['min_amount'] = this.filterMinAmount;
    return filters;
  }

  loadTransactions(done?: () => void) {
    this.txnLoading = true;
    this.bankingService.getTransactions(this.buildTxnFilters()).subscribe({
      next: (res) => {
        this.transactions = res.rows;
        this.txnTotal = res.total;
        this.txnTotals = {
          total_debit: Number(res.total_debit) || 0,
          total_credit: Number(res.total_credit) || 0,
          net_cashflow: Number(res.net_cashflow) || 0
        };
        this.selectedIds.clear();
        this.expandedTxnId = null;
        this.txnLoading = false;
        done?.();
      },
      error: (err) => {
        this.txnLoading = false;
        this.flash('error', err.message || 'Failed to load transactions');
        done?.();
      }
    });
  }

  loadAnalytics(done?: () => void) {
    const filters: Record<string, any> = {};
    if (this.filterAccountId) filters['account_id'] = this.filterAccountId;
    if (this.filterFrom) filters['from'] = this.filterFrom;
    if (this.filterTo) filters['to'] = this.filterTo;

    this.bankingService.getAnalytics(filters).subscribe({
      next: (data) => {
        this.analytics = data;
        this.buildCharts();
        if (data?.categories?.length) {
          this.categories = [...new Set([...this.defaultCategories, ...data.categories])].sort();
        }
        done?.();
      },
      error: (err) => {
        this.flash('error', err.message || 'Failed to load analytics');
        done?.();
      }
    });
  }

  buildCharts() {
    if (!this.analytics) return;

    const cats = (this.analytics.byCategory || []).slice(0, 10);
    this.categoryChartData = {
      labels: cats.map((c: any) => c.category),
      datasets: [{
        data: cats.map((c: any) => Number(c.total_debit) + Number(c.total_credit)),
        backgroundColor: this.chartColors
      }]
    };

    const expenseCats = (this.analytics.expenseByCategory || cats.filter((c: any) => Number(c.total_debit) > 0)).slice(0, 10);
    this.expenseChartData = {
      labels: expenseCats.map((c: any) => c.category),
      datasets: [{
        data: expenseCats.map((c: any) => Number(c.total_debit)),
        backgroundColor: this.chartColors
      }]
    };

    const months = this.analytics.byMonth || [];
    const recentMonths = months.slice(-24);
    this.monthlyChartData = {
      labels: recentMonths.map((m: any) => m.month),
      datasets: [
        {
          label: 'Credits',
          data: recentMonths.map((m: any) => Number(m.total_credit)),
          backgroundColor: 'rgba(16, 185, 129, 0.75)'
        },
        {
          label: 'Debits',
          data: recentMonths.map((m: any) => Number(m.total_debit)),
          backgroundColor: 'rgba(239, 68, 68, 0.75)'
        }
      ]
    };

    this.netChartData = {
      labels: recentMonths.map((m: any) => m.month),
      datasets: [{
        label: 'Net cashflow',
        data: recentMonths.map((m: any) => Number(m.net)),
        borderColor: '#0f172a',
        backgroundColor: 'rgba(15,23,42,0.08)',
        fill: true,
        tension: 0.25,
        pointRadius: 2
      }]
    };

    const series = (this.analytics.balanceSeries || []).slice(-180);
    this.balanceChartData = {
      labels: series.map((p: any) => p.date),
      datasets: [{
        data: series.map((p: any) => Number(p.balance)),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.12)',
        fill: true,
        tension: 0.25,
        pointRadius: 0
      }]
    };

    this.buildPeriodCharts();
    this.buildInterestCharts();
  }

  setCashflowGrain(grain: PeriodGrain) {
    this.cashflowGrain = grain;
    this.buildPeriodCharts();
  }

  buildPeriodCharts() {
    const months = this.analytics?.byMonth || [];
    this.periodRows = this.aggregatePeriods(months, this.cashflowGrain);

    this.periodChartData = {
      labels: this.periodRows.map((r) => r.label),
      datasets: [
        {
          label: 'Credits',
          data: this.periodRows.map((r) => r.total_credit),
          backgroundColor: 'rgba(16, 185, 129, 0.8)'
        },
        {
          label: 'Debits',
          data: this.periodRows.map((r) => r.total_debit),
          backgroundColor: 'rgba(239, 68, 68, 0.8)'
        }
      ]
    };

    this.periodNetChartData = {
      labels: this.periodRows.map((r) => r.label),
      datasets: [{
        label: 'Net',
        data: this.periodRows.map((r) => r.net),
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,0.12)',
        fill: true,
        tension: 0.25,
        pointRadius: 3
      }]
    };

    if (this.periodRows.length) {
      this.periodBest = [...this.periodRows].sort((a, b) => b.net - a.net)[0];
      this.periodWorst = [...this.periodRows].sort((a, b) => a.net - b.net)[0];
    } else {
      this.periodBest = null;
      this.periodWorst = null;
    }
  }

  buildInterestCharts() {
    const rows = this.analytics?.interestByMonth || [];
    this.interestChartData = {
      labels: rows.map((r: any) => r.month),
      datasets: [
        {
          label: 'Interest earned',
          data: rows.map((r: any) => Number(r.interest) || 0),
          backgroundColor: 'rgba(16, 185, 129, 0.8)'
        },
        {
          label: 'TDS / tax',
          data: rows.map((r: any) => Number(r.tax) || 0),
          backgroundColor: 'rgba(245, 158, 11, 0.85)'
        },
        {
          label: 'FD booked',
          data: rows.map((r: any) => Number(r.fd_booked) || 0),
          backgroundColor: 'rgba(99, 102, 241, 0.8)'
        }
      ]
    };
  }

  aggregatePeriods(months: any[], grain: PeriodGrain): PeriodRow[] {
    if (!months?.length) return [];

    if (grain === 'month') {
      return months.map((m: any) => ({
        key: m.month,
        label: m.month,
        total_debit: Number(m.total_debit) || 0,
        total_credit: Number(m.total_credit) || 0,
        net: Number(m.net) || 0,
        txn_count: Number(m.txn_count) || 0
      }));
    }

    const map = new Map<string, PeriodRow>();
    for (const m of months) {
      const ym = String(m.month || '');
      const [y, mo] = ym.split('-').map(Number);
      if (!y || !mo) continue;

      let key = '';
      let label = '';
      if (grain === 'year') {
        key = String(y);
        label = String(y);
      } else {
        const q = Math.ceil(mo / 3);
        key = `${y}-Q${q}`;
        label = `${y} Q${q}`;
      }

      const row = map.get(key) || {
        key,
        label,
        total_debit: 0,
        total_credit: 0,
        net: 0,
        txn_count: 0
      };
      row.total_debit += Number(m.total_debit) || 0;
      row.total_credit += Number(m.total_credit) || 0;
      row.net += Number(m.net) || 0;
      row.txn_count += Number(m.txn_count) || 0;
      map.set(key, row);
    }

    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  openPeriodInTransactions(row: PeriodRow) {
    if (this.cashflowGrain === 'month') {
      this.filterFrom = `${row.key}-01`;
      const [y, m] = row.key.split('-').map(Number);
      const last = new Date(y, m, 0);
      this.filterTo = this.toIsoDate(last);
    } else if (this.cashflowGrain === 'quarter') {
      const [yPart, qPart] = row.key.split('-Q');
      const y = Number(yPart);
      const q = Number(qPart);
      const startMonth = (q - 1) * 3;
      this.filterFrom = this.toIsoDate(new Date(y, startMonth, 1));
      this.filterTo = this.toIsoDate(new Date(y, startMonth + 3, 0));
    } else {
      const y = Number(row.key);
      this.filterFrom = `${y}-01-01`;
      this.filterTo = `${y}-12-31`;
    }
    this.datePreset = 'custom';
    this.filterOffset = 0;
    this.activeTab = 'transactions';
    this.loadTransactions();
    this.flash('info', `Showing transactions for ${row.label}`);
  }

  applyDatePreset(preset: DatePreset) {
    this.datePreset = preset;
    if (preset === 'all') {
      this.filterFrom = '';
      this.filterTo = '';
    } else if (preset === 'custom') {
      return;
    } else {
      const to = new Date();
      const from = new Date();
      if (preset === '1m') from.setMonth(from.getMonth() - 1);
      if (preset === '3m') from.setMonth(from.getMonth() - 3);
      if (preset === '6m') from.setMonth(from.getMonth() - 6);
      if (preset === '1y') from.setFullYear(from.getFullYear() - 1);
      if (preset === 'ytd') {
        from.setMonth(0, 1);
      }
      this.filterFrom = this.toIsoDate(from);
      this.filterTo = this.toIsoDate(to);
    }
    this.filterOffset = 0;
    this.applyFilters();
  }

  onManualDateChange() {
    this.datePreset = 'custom';
  }

  applyFilters() {
    this.filterOffset = 0;
    if (this.activeTab === 'transactions') this.loadTransactions();
    if (this.activeTab === 'insights') this.loadInsights();
    this.loadAnalytics();
    this.loadBudgets();
  }

  clearFilters() {
    this.filterAccountId = '';
    this.filterFrom = '';
    this.filterTo = '';
    this.filterCategory = '';
    this.filterFlow = '';
    this.filterQ = '';
    this.filterMinAmount = '';
    this.filterSort = 'date_desc';
    this.filterOffset = 0;
    this.datePreset = 'all';
    this.applyFilters();
  }

  goToPage(page: number) {
    const p = Math.min(Math.max(1, page), this.totalPages);
    this.filterOffset = (p - 1) * this.filterLimit;
    this.loadTransactions();
  }

  nextPage() {
    if (this.currentPage < this.totalPages) this.goToPage(this.currentPage + 1);
  }

  prevPage() {
    if (this.currentPage > 1) this.goToPage(this.currentPage - 1);
  }

  changePageSize() {
    this.filterOffset = 0;
    localStorage.setItem('bank-txn-page-size', String(this.filterLimit));
    this.loadTransactions();
  }

  changeSort() {
    this.filterOffset = 0;
    this.loadTransactions();
  }

  sortByColumn(column: string) {
    const key = this.columnSortKey[column] || column;
    if (this.sortColumn === column) {
      this.filterSort = `${key}_${this.sortDir === 'asc' ? 'desc' : 'asc'}`;
    } else {
      // Sensible default: newest/largest first for numeric+date, A→Z for text
      const defaultDesc = column === 'date' || column === 'withdrawal' || column === 'deposit' || column === 'balance';
      this.filterSort = `${key}_${defaultDesc ? 'desc' : 'asc'}`;
    }
    this.filterOffset = 0;
    this.loadTransactions();
  }

  sortIndicator(column: string): string {
    if (this.sortColumn !== column) return '↕';
    return this.sortDir === 'asc' ? '▲' : '▼';
  }

  isSorted(column: string): boolean {
    return this.sortColumn === column;
  }

  jumpToPage() {
    if (!this.jumpPage) return;
    this.goToPage(Number(this.jumpPage));
  }

  quickFilter(kind: 'uncategorized' | 'interest' | 'debit' | 'credit' | 'clear') {
    if (kind === 'clear') {
      this.filterCategory = '';
      this.filterFlow = '';
      this.filterQ = '';
    } else if (kind === 'uncategorized') {
      this.filterCategory = 'Uncategorized';
      this.filterFlow = '';
    } else if (kind === 'interest') {
      this.filterCategory = 'Interest Income';
      this.filterFlow = '';
    } else if (kind === 'debit') {
      this.filterFlow = 'debit';
      this.filterCategory = '';
    } else if (kind === 'credit') {
      this.filterFlow = 'credit';
      this.filterCategory = '';
    }
    this.filterOffset = 0;
    if (kind !== 'clear') {
      this.activeTab = 'transactions';
    }
    this.applyFilters();
  }

  filterByCategory(category: string) {
    this.filterCategory = category;
    this.filterOffset = 0;
    this.activeTab = 'transactions';
    this.loadTransactions();
    this.flash('info', `Filtered transactions by category: ${category}`);
  }

  bulkDelete() {
    if (!this.selectedIds.size) return;
    if (!confirm(`Delete ${this.selectedIds.size} selected transactions?`)) return;
    this.bankingService.bulkDelete([...this.selectedIds]).subscribe({
      next: (n) => {
        this.flash('success', `Deleted ${n} transactions`);
        this.loadTransactions();
        this.loadAnalytics();
      },
      error: (err) => this.flash('error', err.message || 'Bulk delete failed')
    });
  }

  toggleExpand(id: number) {
    this.expandedTxnId = this.expandedTxnId === id ? null : id;
  }

  saveTxnDetails(txn: BankTransaction) {
    this.bankingService
      .updateTransaction(txn.id, {
        tags: txn.tags || null,
        notes: txn.notes || null,
        payee: txn.payee || null,
        category: txn.category || undefined
      })
      .subscribe({
        next: (row) => {
          if (row) Object.assign(txn, row);
          this.flash('success', 'Transaction details saved');
        },
        error: (err) => this.flash('error', err.message || 'Save failed')
      });
  }

  openManualTxn() {
    this.manualTxn = this.emptyManualTxn();
    if (this.filterAccountId) this.manualTxn.account_id = Number(this.filterAccountId);
    else if (this.activeAccounts[0]) this.manualTxn.account_id = this.activeAccounts[0].id;
    this.showManualTxn = true;
  }

  saveManualTxn() {
    if (!this.manualTxn.account_id || !this.manualTxn.txn_date) {
      this.flash('error', 'Account and date are required');
      return;
    }
    this.bankingService.createTransaction(this.manualTxn).subscribe({
      next: () => {
        this.showManualTxn = false;
        this.flash('success', 'Manual transaction added');
        this.loadTransactions();
        this.loadAnalytics();
      },
      error: (err) => this.flash('error', err.error?.error || err.message || 'Create failed')
    });
  }

  loadRules(done?: () => void) {
    this.bankingService.getRules().subscribe({
      next: (rows) => {
        this.rules = rows;
        done?.();
      },
      error: () => done?.()
    });
  }

  openRuleForm() {
    this.ruleForm = { pattern: '', match_field: 'narration', category: '', priority: 100, is_active: 1 };
    this.showRuleForm = true;
  }

  saveRule() {
    if (!this.ruleForm.pattern || !this.ruleForm.category) {
      this.flash('error', 'Pattern and category are required');
      return;
    }
    this.bankingService.createRule(this.ruleForm).subscribe({
      next: () => {
        this.showRuleForm = false;
        this.flash('success', 'Rule created');
        this.loadRules();
      },
      error: (err) => this.flash('error', err.message || 'Failed to save rule')
    });
  }

  deleteRule(rule: CategoryRule) {
    if (!rule.id || !confirm(`Delete rule "${rule.pattern}" → ${rule.category}?`)) return;
    this.bankingService.deleteRule(rule.id).subscribe({
      next: () => {
        this.flash('success', 'Rule deleted');
        this.loadRules();
      },
      error: (err) => this.flash('error', err.message || 'Delete failed')
    });
  }

  loadBudgets() {
    const month = new Date().toISOString().slice(0, 7);
    this.budgetForm.period_month = this.budgetForm.period_month || month;
    this.bankingService.getBudgetStatus(month).subscribe({
      next: (rows) => (this.budgets = rows),
      error: () => (this.budgets = [])
    });
  }

  saveBudget() {
    if (!this.budgetForm.category || !this.budgetForm.amount) {
      this.flash('error', 'Category and amount required');
      return;
    }
    this.bankingService.saveBudget(this.budgetForm).subscribe({
      next: () => {
        this.flash('success', 'Budget saved');
        this.budgetForm = {
          category: '',
          amount: 0,
          period_month: new Date().toISOString().slice(0, 7)
        };
        this.loadBudgets();
      },
      error: (err) => this.flash('error', err.message || 'Budget save failed')
    });
  }

  deleteBudget(b: BankBudget) {
    if (!b.id || !confirm(`Delete budget for ${b.category}?`)) return;
    this.bankingService.deleteBudget(b.id).subscribe({
      next: () => {
        this.loadBudgets();
        this.flash('success', 'Budget deleted');
      },
      error: (err) => this.flash('error', err.message || 'Delete failed')
    });
  }

  loadInsights() {
    const accountId = this.filterAccountId ? Number(this.filterAccountId) : undefined;
    this.bankingService.getRecurring(accountId).subscribe({
      next: (rows) => (this.recurring = rows),
      error: () => (this.recurring = [])
    });
    this.bankingService.getForecast(accountId).subscribe({
      next: (data) => (this.forecast = data),
      error: () => (this.forecast = null)
    });
  }

  runTransferMatch() {
    this.bankingService.matchTransfers().subscribe({
      next: (r) => {
        this.flash('success', `Matched ${r.matched} cross-account transfers`);
        this.loadAnalytics();
        this.loadTransactions();
      },
      error: (err) => this.flash('error', err.message || 'Transfer match failed')
    });
  }

  checkContinuity() {
    if (!this.continuityAccountId) {
      this.flash('error', 'Select an account');
      return;
    }
    this.bankingService.getContinuity(Number(this.continuityAccountId)).subscribe({
      next: (data) => {
        this.continuity = data;
        this.flash(
          data.gaps?.length ? 'info' : 'success',
          data.gaps?.length
            ? `Found ${data.gaps.length} balance gaps (showing up to 100)`
            : 'Balance continuity looks good'
        );
      },
      error: (err) => this.flash('error', err.message || 'Continuity check failed')
    });
  }

  undoLastImport() {
    const batchId = this.lastImportResult?.import_batch_id;
    if (!batchId) {
      this.flash('error', 'No recent import batch to undo');
      return;
    }
    if (!confirm(`Undo import batch ${batchId}? This deletes all transactions from that import.`)) return;
    this.bankingService.undoImportBatch(batchId).subscribe({
      next: (r) => {
        this.flash('success', `Removed ${r.deleted} transactions from batch`);
        this.lastImportResult = null;
        this.refreshAll();
        this.loadTransactions();
      },
      error: (err) => this.flash('error', err.message || 'Undo failed')
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    if (file && /\.pdf$/i.test(file.name)) {
      this.importFile = null;
      input.value = '';
      this.flash('error', 'PDF is not supported. Export as CSV or Excel and upload that.');
      return;
    }
    this.importFile = file;
    this.importPreview = null;
    this.lastImportResult = null;
  }

  exportCsv() {
    this.exporting = true;
    this.bankingService.getTransactions(this.buildTxnFilters(true)).subscribe({
      next: (res) => {
        const rows = res.rows;
        const header = ['Date', 'Account', 'Narration', 'Ref', 'Withdrawal', 'Deposit', 'Balance', 'Category', 'Type'];
        const lines = [header.join(',')];
        for (const t of rows) {
          lines.push([
            t.txn_date,
            `${t.bank_name || ''} ${t.account_name || ''}`.trim(),
            this.csvEscape(t.narration || ''),
            this.csvEscape(t.ref_no || ''),
            t.withdrawal || 0,
            t.deposit || 0,
            t.balance ?? '',
            this.csvEscape(t.category || ''),
            t.txn_type || ''
          ].join(','));
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bank-transactions-${this.toIsoDate(new Date())}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        this.exporting = false;
        this.flash('success', `Exported ${rows.length} transactions (max 5000)`);
      },
      error: (err) => {
        this.exporting = false;
        this.flash('error', err.message || 'Export failed');
      }
    });
  }

  csvEscape(value: string): string {
    const v = String(value).replace(/"/g, '""');
    return `"${v}"`;
  }

  openCreateAccount() {
    this.editingAccount = null;
    this.accountForm = this.emptyAccountForm();
    this.showAccountForm = true;
  }

  openEditAccount(account: BankAccount) {
    this.editingAccount = account;
    this.accountForm = { ...account };
    this.showAccountForm = true;
  }

  saveAccount() {
    if (!this.accountForm.bank_name || !this.accountForm.account_name) {
      this.flash('error', 'Bank name and account name are required');
      return;
    }
    const req = this.editingAccount
      ? this.bankingService.updateAccount(this.editingAccount.id, this.accountForm)
      : this.bankingService.createAccount(this.accountForm);

    req.subscribe({
      next: () => {
        this.showAccountForm = false;
        this.flash('success', this.editingAccount ? 'Account updated' : 'Account created');
        this.refreshAll();
      },
      error: (err) => this.flash('error', err.message || 'Save failed')
    });
  }

  deleteAccount(account: BankAccount) {
    if (!confirm(`Delete ${account.bank_name} – ${account.account_name} and all its transactions?`)) return;
    this.bankingService.deleteAccount(account.id).subscribe({
      next: () => {
        this.flash('success', 'Account deleted');
        this.refreshAll();
      },
      error: (err) => this.flash('error', err.message || 'Delete failed')
    });
  }

  previewImport() {
    if (!this.importFile) {
      this.flash('error', 'Choose a statement file first');
      return;
    }
    if (!this.importAccountId) {
      this.flash('error', 'Select a target account before preview');
      return;
    }
    this.importing = true;
    const account = this.accounts.find((a) => a.id === Number(this.importAccountId));
    const hint = this.importBankHint || account?.bank_name || '';
    this.bankingService
      .previewStatement(this.importFile, Number(this.importAccountId), hint || undefined)
      .subscribe({
        next: (data) => {
          this.importPreview = data;
          this.importing = false;
          const existing = data.existing_count ?? 0;
          const neu = data.new_count ?? data.count ?? 0;
          this.flash(
            'info',
            `${data.bank}: ${data.count} in file · ${existing} already exist · ${neu} new`
          );
        },
        error: (err) => {
          this.importing = false;
          this.flash('error', err.error?.error || err.message || 'Preview failed');
        }
      });
  }

  runImport() {
    if (!this.importFile || !this.importAccountId) {
      this.flash('error', 'Select an account and a statement file');
      return;
    }
    this.importing = true;
    const account = this.accounts.find((a) => a.id === Number(this.importAccountId));
    const hint = this.importBankHint || account?.bank_name || '';
    this.bankingService.importStatement(Number(this.importAccountId), this.importFile, hint).subscribe({
      next: (data) => {
        this.lastImportResult = data;
        this.importing = false;
        let msg = `Imported ${data.inserted} new · skipped ${data.skipped} duplicates · parsed ${data.parsed}`;
        if (data.opening_warning) {
          msg += ` · opening balance may not match first statement balance`;
        }
        this.flash('success', msg);
        this.refreshAll();
        this.loadTransactions();
      },
      error: (err) => {
        this.importing = false;
        this.flash('error', err.error?.error || err.message || 'Import failed');
      }
    });
  }

  toggleSelect(id: number) {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
  }

  toggleSelectAll() {
    if (this.selectedIds.size === this.transactions.length) {
      this.selectedIds.clear();
      return;
    }
    this.transactions.forEach((t) => this.selectedIds.add(t.id));
  }

  applyBulkCategory() {
    if (!this.bulkCategory || !this.selectedIds.size) return;
    this.bankingService.bulkCategorize([...this.selectedIds], this.bulkCategory).subscribe({
      next: (n) => {
        this.flash('success', `Updated category on ${n} transactions`);
        this.loadTransactions();
        this.loadAnalytics();
      },
      error: (err) => this.flash('error', err.message || 'Bulk update failed')
    });
  }

  updateRowCategory(txn: BankTransaction, category: string) {
    this.bankingService.updateTransaction(txn.id, { category }).subscribe({
      next: () => {
        txn.category = category;
      },
      error: (err) => this.flash('error', err.message || 'Update failed')
    });
  }

  recategorize() {
    this.bankingService
      .recategorize(
        this.filterAccountId ? Number(this.filterAccountId) : undefined,
        this.recategorizeMode
      )
      .subscribe({
        next: (n) => {
          this.flash(
            'success',
            `Auto-categorized ${n} transactions (${this.recategorizeMode.replace('_', ' ')})`
          );
          this.loadTransactions();
          this.loadAnalytics();
        },
        error: (err) => this.flash('error', err.message || 'Recategorize failed')
      });
  }

  deleteTxn(txn: BankTransaction) {
    if (!confirm('Delete this transaction?')) return;
    this.bankingService.deleteTransaction(txn.id).subscribe({
      next: () => {
        this.loadTransactions();
        this.loadAnalytics();
      },
      error: (err) => this.flash('error', err.message || 'Delete failed')
    });
  }

  totalBalance(): number {
    return this.activeAccounts.reduce((s, a) => s + (Number(a.latest_balance) || 0), 0);
  }

  currencySymbol(currency?: string | null): string {
    const c = (currency || 'INR').toUpperCase();
    if (c === 'INR') return '₹';
    if (c === 'USD') return '$';
    if (c === 'EUR') return '€';
    if (c === 'GBP') return '£';
    return c + ' ';
  }

  formatMoney(value: any): string {
    const n = Number(value) || 0;
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  formatCurrency(value: any, currency?: string | null): string {
    return `${this.currencySymbol(currency)}${this.formatMoney(value)}`;
  }

  formatPct(value: any): string {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    const n = Number(value);
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toFixed(1)}%`;
  }

  flash(type: 'success' | 'error' | 'info', text: string) {
    this.messageType = type;
    this.message = text;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.message = '';
    }, 6000);
  }

  maskAccount(num?: string | null): string {
    if (!num) return '—';
    const s = String(num);
    if (s.length <= 4) return s;
    return '••••' + s.slice(-4);
  }

  toIsoDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  categoryPct(amount: number): number {
    const total = Number(this.analytics?.summary?.total_debit) || 0;
    if (!total) return 0;
    return (Number(amount) / total) * 100;
  }
}
