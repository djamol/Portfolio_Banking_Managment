import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, merge, takeUntil } from 'rxjs';
import { BankImportService } from '../../../services/banking/bank-import.service';
import { formatMoney } from '../shared/banking-format.util';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

@Component({
  selector: 'app-banking-import',
  templateUrl: './banking-import.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-import.component.css'],
  standalone: false
})
export class BankingImportComponent implements OnInit, OnDestroy {
  importAccountId: number | '' = '';
  importBankHint = '';
  importFile: File | null = null;
  importPdfPassword = '';
  showPdfPassword = false;
  pdfPasswordError = '';
  importPreview: any = null;
  importing = false;
  lastImportResult: any = null;
  backupImportFile: File | null = null;
  backupImporting = false;
  lastBackupImportResult: any = null;

  readonly bankSupport = [
    { name: 'HDFC', formats: 'CSV / Excel', status: 'Full' },
    { name: 'HDFC Credit Card', formats: 'PDF (Millennia / Regalia; password OK)', status: 'Full' },
    { name: 'ICICI', formats: 'XLS / XLSX', status: 'Full' },
    { name: 'ICICI Credit Card', formats: 'PDF (password OK) / CSV', status: 'Full' },
    { name: 'DCB', formats: 'XLS / XLSX', status: 'Full' },
    { name: 'SBI', formats: 'CSV / Excel', status: 'Generic+' },
    { name: 'Axis', formats: 'CSV / Excel', status: 'Generic+' },
    { name: 'Kotak', formats: 'CSV / Excel', status: 'Full' }
  ];

  private readonly destroy$ = new Subject<void>();

  constructor(
    public ctx: BankingContextService,
    private filters: BankingFilterState,
    private importService: BankImportService
  ) {}

  ngOnInit() {
    this.ctx.loadAccounts(() => this.ensureImportAccount());
    merge(this.ctx.accounts$, this.filters.refreshRequested$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.ensureImportAccount());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ensureImportAccount() {
    if (!this.importAccountId && this.ctx.activeAccounts.length) {
      this.importAccountId = this.ctx.activeAccounts[0].id;
    }
  }

  requestExportPanel() {
    this.ctx.requestExportPanel(false);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.importFile = file;
    this.importPreview = null;
    this.lastImportResult = null;
    this.pdfPasswordError = '';
    this.showPdfPassword = !!(file && /\.pdf$/i.test(file.name));
    if (!this.showPdfPassword) this.importPdfPassword = '';
  }

  onPdfPasswordChange() {
    this.pdfPasswordError = '';
  }

  onBackupFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.backupImportFile = input.files?.[0] || null;
    this.lastBackupImportResult = null;
  }

  private extractApiError(err: any, fallback: string): { message: string; code?: string } {
    const body = err?.error;
    const code = body?.code || err?.code;
    const message =
      (typeof body === 'string' ? body : null) ||
      body?.error ||
      err?.message ||
      fallback;
    return { message: String(message), code };
  }

  private handleImportError(err: any, fallback: string) {
    const { message, code } = this.extractApiError(err, fallback);
    if (
      code === 'PDF_PASSWORD_INCORRECT' ||
      code === 'PDF_PASSWORD_REQUIRED' ||
      /incorrect\s*pdf\s*password/i.test(message) ||
      /password-protected/i.test(message)
    ) {
      this.pdfPasswordError =
        code === 'PDF_PASSWORD_REQUIRED' || /password-protected/i.test(message)
          ? 'This PDF is password-protected. Enter the statement password and try again.'
          : 'Incorrect PDF password. Check the password and try again.';
      this.ctx.flash('error', this.pdfPasswordError);
      return;
    }
    this.pdfPasswordError = '';
    this.ctx.flash('error', message || fallback);
  }

  runBackupImport() {
    if (!this.backupImportFile) {
      this.ctx.flash('error', 'Select an exported .xlsx / .csv file');
      return;
    }
    this.backupImporting = true;
    this.importService.importTransactionBackup(this.backupImportFile).subscribe({
      next: (data) => {
        this.backupImporting = false;
        this.lastBackupImportResult = data;
        this.ctx.flash(
          'success',
          `Backup import: ${data.inserted} inserted · ${data.skipped} skipped · ${data.unresolved || 0} unresolved accounts`
        );
        this.ctx.refreshCore();
        this.filters.requestRefresh();
      },
      error: (err) => {
        this.backupImporting = false;
        this.ctx.flash('error', err.message || 'Backup import failed');
      }
    });
  }

  resolveImportBankHint(account?: { bank_name?: string; account_type?: string } | null): string {
    if (this.importBankHint) return this.importBankHint;
    const type = String(account?.account_type || '');
    const bank = String(account?.bank_name || '');
    if (/credit\s*card/i.test(type) || /\bcc\b/i.test(type)) {
      if (/icici/i.test(bank)) return 'ICICI_CC';
      if (/hdfc/i.test(bank)) return 'HDFC_CC';
      return '';
    }
    return bank;
  }

  previewImport() {
    if (!this.importFile) {
      this.ctx.flash('error', 'Choose a statement file first');
      return;
    }
    if (!this.importAccountId) {
      this.ctx.flash('error', 'Select a target account before preview');
      return;
    }
    this.pdfPasswordError = '';
    if (this.showPdfPassword && !this.importPdfPassword.trim()) {
      this.pdfPasswordError =
        'Enter the PDF password (credit card statements are usually locked)';
      this.ctx.flash('error', this.pdfPasswordError);
      return;
    }
    this.importing = true;
    const account = this.ctx.accounts.find((a) => a.id === Number(this.importAccountId));
    const hint = this.resolveImportBankHint(account);
    this.importService
      .previewStatement(
        this.importFile,
        Number(this.importAccountId),
        hint || undefined,
        this.importPdfPassword || undefined
      )
      .subscribe({
        next: (data) => {
          this.importPreview = data;
          this.importing = false;
          this.pdfPasswordError = '';
          const existing = data.existing_count ?? 0;
          const neu = data.new_count ?? data.count ?? 0;
          this.ctx.flash('info', `${data.bank}: ${data.count} in file · ${existing} already exist · ${neu} new`);
        },
        error: (err) => {
          this.importing = false;
          this.handleImportError(err, 'Preview failed');
        }
      });
  }

  runImport() {
    if (!this.importFile || !this.importAccountId) {
      this.ctx.flash('error', 'Select an account and a statement file');
      return;
    }
    this.pdfPasswordError = '';
    if (this.showPdfPassword && !this.importPdfPassword.trim()) {
      this.pdfPasswordError =
        'Enter the PDF password (credit card statements are usually locked)';
      this.ctx.flash('error', this.pdfPasswordError);
      return;
    }
    this.importing = true;
    const account = this.ctx.accounts.find((a) => a.id === Number(this.importAccountId));
    const hint = this.resolveImportBankHint(account);
    this.importService
      .importStatement(
        Number(this.importAccountId),
        this.importFile,
        hint,
        this.importPdfPassword || undefined
      )
      .subscribe({
        next: (data) => {
          this.lastImportResult = data;
          this.importing = false;
          this.pdfPasswordError = '';
          let msg = `Imported ${data.inserted} new · skipped ${data.skipped} duplicates · parsed ${data.parsed}`;
          if (data.opening_warning) {
            msg += ' · opening balance may not match first statement balance';
          }
          this.ctx.flash('success', msg);
          this.ctx.refreshCore();
          this.filters.requestRefresh();
        },
        error: (err) => {
          this.importing = false;
          this.handleImportError(err, 'Import failed');
        }
      });
  }

  undoLastImport() {
    const batchId = this.lastImportResult?.import_batch_id;
    if (!batchId) {
      this.ctx.flash('error', 'No recent import batch to undo');
      return;
    }
    if (!confirm(`Undo import batch ${batchId}? This deletes all transactions from that import.`)) return;
    this.importService.undoImportBatch(batchId).subscribe({
      next: (r) => {
        this.ctx.flash('success', `Removed ${r.deleted} transactions from batch`);
        this.lastImportResult = null;
        this.ctx.refreshCore();
        this.filters.requestRefresh();
      },
      error: (err) => this.ctx.flash('error', err.message || 'Undo failed')
    });
  }

  formatMoney = formatMoney;
}
