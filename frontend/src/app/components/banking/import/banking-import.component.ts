import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, firstValueFrom, merge, takeUntil } from 'rxjs';
import { BankImportService } from '../../../services/banking/bank-import.service';
import { formatMoney } from '../shared/banking-format.util';
import { BankingContextService } from '../shared/banking-context.service';
import { BankingFilterState } from '../shared/banking-filter-state.service';

export interface ImportFileResult {
  file: string;
  ok: boolean;
  error?: string;
  code?: string;
  bank?: string;
  count?: number;
  existing_count?: number;
  new_count?: number;
  parsed?: number;
  inserted?: number;
  skipped?: number;
  import_batch_id?: string;
  date_from?: string;
  date_to?: string;
  total_debit?: number;
  total_credit?: number;
  meta?: any;
  preview?: any[];
}

@Component({
  selector: 'app-banking-import',
  templateUrl: './banking-import.component.html',
  styleUrls: ['../shared/banking-shared.css', './banking-import.component.css'],
  standalone: false
})
export class BankingImportComponent implements OnInit, OnDestroy {
  importAccountId: number | '' = '';
  importBankHint = '';
  importFiles: File[] = [];
  importPdfPassword = '';
  showPdfPassword = false;
  pdfPasswordError = '';
  importPreview: any = null;
  importing = false;
  importProgress = '';
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
    { name: 'SBI Credit Card', formats: 'PDF (password OK)', status: 'Full' },
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

  get hasImportFiles(): boolean {
    return this.importFiles.length > 0;
  }

  ensureImportAccount() {
    if (!this.importAccountId && this.ctx.activeAccounts.length) {
      this.importAccountId = this.ctx.activeAccounts[0].id;
    }
  }

  requestExportPanel() {
    this.ctx.requestExportPanel(false);
  }

  private refreshPdfPasswordVisibility() {
    this.showPdfPassword = this.importFiles.some((f) => /\.pdf$/i.test(f.name));
    if (!this.showPdfPassword) {
      this.importPdfPassword = '';
      this.pdfPasswordError = '';
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files || []);
    if (!picked.length) return;

    const byKey = new Map(this.importFiles.map((f) => [`${f.name}|${f.size}|${f.lastModified}`, f]));
    for (const f of picked) {
      byKey.set(`${f.name}|${f.size}|${f.lastModified}`, f);
    }
    this.importFiles = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
    this.importPreview = null;
    this.lastImportResult = null;
    this.pdfPasswordError = '';
    this.refreshPdfPasswordVisibility();
    // Allow re-selecting the same files later
    input.value = '';
  }

  removeImportFile(index: number) {
    this.importFiles = this.importFiles.filter((_, i) => i !== index);
    this.importPreview = null;
    this.lastImportResult = null;
    this.pdfPasswordError = '';
    this.refreshPdfPasswordVisibility();
  }

  clearImportFiles() {
    this.importFiles = [];
    this.importPreview = null;
    this.lastImportResult = null;
    this.pdfPasswordError = '';
    this.refreshPdfPasswordVisibility();
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

  private isPdfPasswordError(message: string, code?: string): boolean {
    return (
      code === 'PDF_PASSWORD_INCORRECT' ||
      code === 'PDF_PASSWORD_REQUIRED' ||
      /incorrect\s*pdf\s*password/i.test(message) ||
      /password-protected/i.test(message)
    );
  }

  private applyPdfPasswordError(message: string, code?: string) {
    this.pdfPasswordError =
      code === 'PDF_PASSWORD_REQUIRED' || /password-protected/i.test(message)
        ? 'This PDF is password-protected. Enter the statement password and try again.'
        : 'Incorrect PDF password. Check the password and try again.';
    this.ctx.flash('error', this.pdfPasswordError);
  }

  private handleImportError(err: any, fallback: string) {
    const { message, code } = this.extractApiError(err, fallback);
    if (this.isPdfPasswordError(message, code)) {
      this.applyPdfPasswordError(message, code);
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
      if (/sbi/i.test(bank) || /state\s*bank/i.test(bank)) return 'SBI_CC';
      return '';
    }
    return bank;
  }

  private requirePdfPasswordIfNeeded(): boolean {
    this.pdfPasswordError = '';
    if (this.showPdfPassword && !this.importPdfPassword.trim()) {
      this.pdfPasswordError =
        'Enter the PDF password (credit card statements are usually locked)';
      this.ctx.flash('error', this.pdfPasswordError);
      return false;
    }
    return true;
  }

  async previewImport() {
    if (!this.hasImportFiles) {
      this.ctx.flash('error', 'Choose one or more statement files first');
      return;
    }
    if (!this.importAccountId) {
      this.ctx.flash('error', 'Select a target account before preview');
      return;
    }
    if (!this.requirePdfPasswordIfNeeded()) return;

    this.importing = true;
    this.importProgress = '';
    this.importPreview = null;
    const account = this.ctx.accounts.find((a) => a.id === Number(this.importAccountId));
    const hint = this.resolveImportBankHint(account);
    const fileResults: ImportFileResult[] = [];
    let totalCount = 0;
    let totalExisting = 0;
    let totalNew = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    let minDate: string | null = null;
    let maxDate: string | null = null;
    const samplePreview: any[] = [];
    const banks = new Set<string>();
    let meta: any = null;
    let stoppedOnPassword = false;

    try {
      for (let i = 0; i < this.importFiles.length; i++) {
        const file = this.importFiles[i];
        this.importProgress = `Previewing ${i + 1}/${this.importFiles.length}: ${file.name}`;
        try {
          const data = await firstValueFrom(
            this.importService.previewStatement(
              file,
              Number(this.importAccountId),
              hint || undefined,
              this.importPdfPassword || undefined
            )
          );
          fileResults.push({
            file: file.name,
            ok: true,
            bank: data.bank,
            count: data.count,
            existing_count: data.existing_count,
            new_count: data.new_count,
            date_from: data.date_from,
            date_to: data.date_to,
            total_debit: data.total_debit,
            total_credit: data.total_credit,
            meta: data.meta,
            preview: data.preview
          });
          if (data.bank) banks.add(data.bank);
          totalCount += Number(data.count) || 0;
          totalExisting += Number(data.existing_count) || 0;
          totalNew += Number(data.new_count) || 0;
          totalDebit += Number(data.total_debit) || 0;
          totalCredit += Number(data.total_credit) || 0;
          if (data.date_from && (!minDate || data.date_from < minDate)) minDate = data.date_from;
          if (data.date_to && (!maxDate || data.date_to > maxDate)) maxDate = data.date_to;
          if (!meta && data.meta) meta = data.meta;
          if (samplePreview.length < 25 && data.preview?.length) {
            for (const row of data.preview) {
              if (samplePreview.length >= 25) break;
              samplePreview.push({ ...row, _file: file.name });
            }
          }
        } catch (err) {
          const { message, code } = this.extractApiError(err, 'Preview failed');
          fileResults.push({ file: file.name, ok: false, error: message, code });
          if (this.isPdfPasswordError(message, code)) {
            this.applyPdfPasswordError(message, code);
            stoppedOnPassword = true;
            break;
          }
        }
      }

      const okCount = fileResults.filter((r) => r.ok).length;
      const failCount = fileResults.filter((r) => !r.ok).length;
      this.importPreview = {
        multi: this.importFiles.length > 1,
        files: fileResults,
        file_count: this.importFiles.length,
        ok_count: okCount,
        fail_count: failCount,
        bank: [...banks].join(', ') || (okCount ? '—' : 'failed'),
        count: totalCount,
        existing_count: totalExisting,
        new_count: totalNew,
        date_from: minDate,
        date_to: maxDate,
        total_debit: Math.round(totalDebit * 100) / 100,
        total_credit: Math.round(totalCredit * 100) / 100,
        meta,
        preview: samplePreview
      };

      if (!stoppedOnPassword) {
        if (failCount && !okCount) {
          this.ctx.flash('error', `Preview failed for all ${failCount} file(s)`);
        } else if (failCount) {
          this.ctx.flash(
            'info',
            `Preview: ${okCount} ok · ${failCount} failed · ${totalCount} txns · ${totalNew} new`
          );
        } else {
          this.ctx.flash(
            'info',
            `${this.importPreview.bank}: ${this.importFiles.length} file(s) · ${totalCount} txns · ${totalExisting} exist · ${totalNew} new`
          );
        }
      }
    } finally {
      this.importing = false;
      this.importProgress = '';
    }
  }

  async runImport() {
    if (!this.hasImportFiles || !this.importAccountId) {
      this.ctx.flash('error', 'Select an account and one or more statement files');
      return;
    }
    if (!this.requirePdfPasswordIfNeeded()) return;

    this.importing = true;
    this.importProgress = '';
    const account = this.ctx.accounts.find((a) => a.id === Number(this.importAccountId));
    const hint = this.resolveImportBankHint(account);
    const fileResults: ImportFileResult[] = [];
    let parsed = 0;
    let inserted = 0;
    let skipped = 0;
    const batches: string[] = [];
    const banks = new Set<string>();
    let stoppedOnPassword = false;

    try {
      for (let i = 0; i < this.importFiles.length; i++) {
        const file = this.importFiles[i];
        this.importProgress = `Importing ${i + 1}/${this.importFiles.length}: ${file.name}`;
        try {
          const data = await firstValueFrom(
            this.importService.importStatement(
              Number(this.importAccountId),
              file,
              hint,
              this.importPdfPassword || undefined
            )
          );
          fileResults.push({
            file: file.name,
            ok: true,
            bank: data.bank,
            parsed: data.parsed,
            inserted: data.inserted,
            skipped: data.skipped,
            import_batch_id: data.import_batch_id
          });
          if (data.bank) banks.add(data.bank);
          parsed += Number(data.parsed) || 0;
          inserted += Number(data.inserted) || 0;
          skipped += Number(data.skipped) || 0;
          if (data.import_batch_id) batches.push(data.import_batch_id);
        } catch (err) {
          const { message, code } = this.extractApiError(err, 'Import failed');
          fileResults.push({ file: file.name, ok: false, error: message, code });
          if (this.isPdfPasswordError(message, code)) {
            this.applyPdfPasswordError(message, code);
            stoppedOnPassword = true;
            break;
          }
        }
      }

      const okCount = fileResults.filter((r) => r.ok).length;
      const failCount = fileResults.filter((r) => !r.ok).length;
      this.lastImportResult = {
        multi: this.importFiles.length > 1,
        files: fileResults,
        file_count: this.importFiles.length,
        ok_count: okCount,
        fail_count: failCount,
        bank: [...banks].join(', ') || (okCount ? '—' : 'failed'),
        parsed,
        inserted,
        skipped,
        import_batch_id: batches[0] || null,
        import_batch_ids: batches
      };

      if (!stoppedOnPassword) {
        if (failCount && !okCount) {
          this.ctx.flash('error', `Import failed for all ${failCount} file(s)`);
        } else {
          let msg = `Imported ${inserted} new · skipped ${skipped} duplicates · parsed ${parsed} from ${okCount}/${this.importFiles.length} file(s)`;
          if (failCount) msg += ` · ${failCount} file(s) failed`;
          this.ctx.flash(failCount ? 'info' : 'success', msg);
          this.ctx.refreshCore();
          this.filters.requestRefresh();
        }
      } else if (okCount) {
        this.ctx.refreshCore();
        this.filters.requestRefresh();
      }
    } finally {
      this.importing = false;
      this.importProgress = '';
    }
  }

  async undoLastImport() {
    const batchIds: string[] = Array.isArray(this.lastImportResult?.import_batch_ids)
      ? this.lastImportResult.import_batch_ids.filter(Boolean)
      : this.lastImportResult?.import_batch_id
        ? [this.lastImportResult.import_batch_id]
        : [];
    if (!batchIds.length) {
      this.ctx.flash('error', 'No recent import batch to undo');
      return;
    }
    const label = batchIds.length === 1 ? batchIds[0] : `${batchIds.length} batches`;
    if (!confirm(`Undo import ${label}? This deletes all transactions from that import.`)) return;

    let deleted = 0;
    for (const batchId of batchIds) {
      try {
        const r = await firstValueFrom(this.importService.undoImportBatch(batchId));
        deleted += Number(r.deleted) || 0;
      } catch (err: any) {
        this.ctx.flash('error', err.message || `Undo failed for batch ${batchId}`);
        this.ctx.refreshCore();
        this.filters.requestRefresh();
        return;
      }
    }
    this.ctx.flash('success', `Removed ${deleted} transactions from ${batchIds.length} batch(es)`);
    this.lastImportResult = null;
    this.ctx.refreshCore();
    this.filters.requestRefresh();
  }

  formatMoney = formatMoney;
}
