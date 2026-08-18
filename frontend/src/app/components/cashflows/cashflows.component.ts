import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CashflowService, InvestmentTransaction, CashflowListMeta } from '../../services/cashflow.service';
import { InvestmentService } from '../../services/investment.service';
import { formatIndianFull } from '../../utils/indian-number.util';

@Component({
  selector: 'app-cashflows',
  templateUrl: './cashflows.component.html',
  styleUrls: ['./cashflows.component.css']
})
export class CashflowsComponent implements OnInit {
  readonly txnTypes = [
    'buy',
    'sell',
    'dividend',
    'interest',
    'fee',
    'deposit',
    'withdrawal',
    'transfer_in',
    'transfer_out'
  ];

  investments: any[] = [];
  transactions: InvestmentTransaction[] = [];
  meta: CashflowListMeta = {
    total: 0,
    limit: 50,
    offset: 0,
    total_inflow: 0,
    total_outflow: 0,
    net_cashflow: 0
  };

  filterInvestmentId: number | '' = '';
  filterFrom = '';
  filterTo = '';
  filterTxnType = '';
  itemsPerPage = 50;
  currentPage = 1;

  loading = false;
  saving = false;
  errorMessage = '';
  successMessage = '';

  showModal = false;
  isEditing = false;
  editingId: number | null = null;
  form: {
    investment_id: number | '';
    txn_date: string;
    txn_type: string;
    units: number | null;
    price: number | null;
    cashflow_amount: number | null;
    notes: string;
  } = this.emptyForm();

  constructor(
    private cashflowService: CashflowService,
    private investmentService: InvestmentService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.loadInvestments();
    this.route.queryParamMap.subscribe(params => {
      const id = params.get('investmentId');
      if (id && Number(id)) {
        this.filterInvestmentId = Number(id);
      }
      this.loadTransactions();
    });
  }

  get hasActiveFilters(): boolean {
    return !!(this.filterInvestmentId || this.filterFrom || this.filterTo || this.filterTxnType);
  }

  emptyForm() {
    return {
      investment_id: '' as number | '',
      txn_date: new Date().toISOString().slice(0, 10),
      txn_type: 'buy',
      units: null as number | null,
      price: null as number | null,
      cashflow_amount: null as number | null,
      notes: ''
    };
  }

  investmentLabel(inv: any): string {
    const parts = [
      inv.website_app_name,
      inv.investment_type,
      inv.sub_type_name,
      inv.sub_type_category
    ].filter(Boolean);
    const label = parts.join(' · ');
    return `${label} (₹${formatIndianFull(Number(inv.amount) || 0)})`;
  }

  loadInvestments(): void {
    this.investmentService.getAll().subscribe({
      next: (rows) => {
        this.investments = rows || [];
      },
      error: () => {
        this.investments = [];
      }
    });
  }

  loadTransactions(): void {
    this.loading = true;
    this.errorMessage = '';
    const offset = (this.currentPage - 1) * this.itemsPerPage;
    this.cashflowService
      .list({
        investment_id: this.filterInvestmentId || undefined,
        from: this.filterFrom || undefined,
        to: this.filterTo || undefined,
        txn_type: this.filterTxnType || undefined,
        limit: this.itemsPerPage,
        offset
      })
      .subscribe({
        next: (result) => {
          this.transactions = result.data;
          this.meta = result.meta;
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.errorMessage = err?.error?.error || 'Failed to load cashflows';
          this.transactions = [];
        }
      });
  }

  applyFilters(): void {
    this.currentPage = 1;
    this.loadTransactions();
  }

  clearFilters(): void {
    this.filterInvestmentId = '';
    this.filterFrom = '';
    this.filterTo = '';
    this.filterTxnType = '';
    this.currentPage = 1;
    this.loadTransactions();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil((this.meta.total || 0) / this.itemsPerPage));
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.loadTransactions();
  }

  onItemsPerPageChange(): void {
    this.currentPage = 1;
    this.loadTransactions();
  }

  openAddModal(): void {
    this.isEditing = false;
    this.editingId = null;
    this.form = this.emptyForm();
    if (this.filterInvestmentId) {
      this.form.investment_id = this.filterInvestmentId;
    }
    this.showModal = true;
  }

  openEditModal(txn: InvestmentTransaction): void {
    this.isEditing = true;
    this.editingId = txn.id;
    this.form = {
      investment_id: txn.investment_id,
      txn_date: String(txn.txn_date).slice(0, 10),
      txn_type: txn.txn_type,
      units: txn.units != null ? Number(txn.units) : null,
      price: txn.price != null ? Number(txn.price) : null,
      cashflow_amount: Math.abs(Number(txn.cashflow_amount) || 0),
      notes: txn.notes || ''
    };
    this.showModal = true;
  }

  closeModal(): void {
    this.showModal = false;
    this.saving = false;
  }

  onSubmit(): void {
    if (!this.form.investment_id || !this.form.txn_date || !this.form.txn_type || this.form.cashflow_amount == null) {
      this.errorMessage = 'Investment, date, type, and amount are required';
      return;
    }

    this.saving = true;
    this.errorMessage = '';
    const payload = {
      investment_id: Number(this.form.investment_id),
      txn_date: this.form.txn_date,
      txn_type: this.form.txn_type,
      units: this.form.units,
      price: this.form.price,
      cashflow_amount: Number(this.form.cashflow_amount),
      notes: this.form.notes || null
    };

    const req$ =
      this.isEditing && this.editingId != null
        ? this.cashflowService.update(this.editingId, payload)
        : this.cashflowService.create(payload);

    req$.subscribe({
      next: () => {
        this.saving = false;
        this.showModal = false;
        this.successMessage = this.isEditing ? 'Cashflow updated' : 'Cashflow added';
        setTimeout(() => (this.successMessage = ''), 2500);
        this.loadTransactions();
      },
      error: (err) => {
        this.saving = false;
        this.errorMessage = err?.error?.error || 'Failed to save cashflow';
      }
    });
  }

  deleteTxn(txn: InvestmentTransaction): void {
    const label = `${txn.txn_type} on ${String(txn.txn_date).slice(0, 10)}`;
    if (!confirm(`Delete ${label}?`)) return;
    this.cashflowService.delete(txn.id).subscribe({
      next: () => {
        this.successMessage = 'Cashflow deleted';
        setTimeout(() => (this.successMessage = ''), 2500);
        if (this.transactions.length === 1 && this.currentPage > 1) {
          this.currentPage -= 1;
        }
        this.loadTransactions();
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Failed to delete cashflow';
      }
    });
  }

  formatMoney(value: number | null | undefined): string {
    const n = Number(value) || 0;
    const sign = n < 0 ? '-' : '';
    return `${sign}₹${formatIndianFull(n)}`;
  }

  formatTxnType(type: string): string {
    return (type || '').replace(/_/g, ' ');
  }

  amountClass(amount: number): string {
    return Number(amount) >= 0 ? 'inflow' : 'outflow';
  }

  exportCsv(): void {
    this.cashflowService
      .list({
        investment_id: this.filterInvestmentId || undefined,
        from: this.filterFrom || undefined,
        to: this.filterTo || undefined,
        txn_type: this.filterTxnType || undefined,
        limit: 10000,
        offset: 0
      })
      .subscribe({
        next: (result) => {
          const rows = result.data || [];
          if (!rows.length) return;
          const headers = ['Date', 'Investment', 'Type', 'Units', 'Price', 'Cashflow', 'Notes'];
          const lines = rows.map(item => [
            this.csvEscape(String(item.txn_date || '').slice(0, 10)),
            this.csvEscape([item.website_app_name, item.investment_type, item.sub_type_name].filter(Boolean).join(' · ')),
            this.csvEscape(item.txn_type || ''),
            item.units != null ? String(item.units) : '',
            item.price != null ? Number(item.price).toFixed(2) : '',
            Number(item.cashflow_amount || 0).toFixed(2),
            this.csvEscape(item.notes || '')
          ].join(','));
          const csv = [headers.join(','), ...lines].join('\n');
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `cashflows-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: (err) => {
          this.errorMessage = err?.error?.error || 'Failed to export cashflows';
        }
      });
  }

  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
