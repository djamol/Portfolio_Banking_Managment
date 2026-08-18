import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiResponse } from './banking.models';
import { bankApiUrl } from './bank-api.util';

export type BankExportFormat = 'xlsx' | 'pdf' | 'csv';
export type BankExportLayout = 'statement' | 'raw';

export type BankExportResult = {
  blob: Blob;
  filename: string;
  rowCount: number;
  truncated: boolean;
};

@Injectable({ providedIn: 'root' })
export class BankImportService {
  constructor(private http: HttpClient) {}

  undoImportBatch(batchId: string): Observable<{ deleted: number; found: number }> {
    return this.http
      .delete<ApiResponse<{ deleted: number; found: number }>>(bankApiUrl(`import/batches/${batchId}`))
      .pipe(map((r) => r.data || { deleted: 0, found: 0 }));
  }

  exportTransactions(
    filters: Record<string, any> = {},
    opts: {
      format?: BankExportFormat;
      layout?: BankExportLayout;
      applyFilters?: boolean;
      includeCategory?: boolean;
    } = {}
  ): Observable<BankExportResult> {
    let params = new HttpParams()
      .set('format', opts.format || 'xlsx')
      .set('layout', opts.layout || 'statement');
    if (opts.applyFilters) params = params.set('apply_filters', '1');
    if (opts.includeCategory) params = params.set('include_category', '1');
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
    });
    return this.http
      .get(bankApiUrl('export/transactions'), {
        params,
        responseType: 'blob',
        observe: 'response'
      })
      .pipe(map((res) => this.exportResultFromResponse(res, opts.format || 'xlsx', opts.layout || 'statement')));
  }

  downloadExport(result: BankExportResult) {
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private exportResultFromResponse(
    res: HttpResponse<Blob>,
    format: BankExportFormat,
    layout: BankExportLayout
  ): BankExportResult {
    const blob = res.body || new Blob();
    const filename =
      res.headers.get('X-Export-Filename') ||
      this.filenameFromDisposition(res.headers.get('Content-Disposition')) ||
      (layout === 'raw' ? `bank_transactions_backup.${format}` : `Bank_Statement.${format}`);
    return {
      blob,
      filename,
      rowCount: Number(res.headers.get('X-Export-Row-Count') || 0),
      truncated: res.headers.get('X-Export-Truncated') === '1'
    };
  }

  private filenameFromDisposition(cd: string | null): string | null {
    if (!cd) return null;
    const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
    if (star?.[1]) {
      try {
        return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
      } catch {
        return star[1].trim();
      }
    }
    const plain = /filename="([^"]+)"/i.exec(cd);
    return plain?.[1] || null;
  }

  importTransactionBackup(file: File): Observable<{
    inserted: number;
    skipped: number;
    unresolved: number;
    total: number;
    import_batch_id: string;
  }> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ApiResponse<any>>(bankApiUrl('import/transactions'), form).pipe(
      map((r) => {
        if (!r.success) throw new Error(r.error || 'Import failed');
        return r.data;
      })
    );
  }

  importStatement(
    accountId: number,
    file: File,
    bankHint?: string,
    pdfPassword?: string
  ): Observable<any> {
    const form = new FormData();
    form.append('file', file);
    form.append('account_id', String(accountId));
    if (bankHint) form.append('bank_hint', bankHint);
    if (pdfPassword) form.append('pdf_password', pdfPassword);
    return this.http.post<ApiResponse<any>>(bankApiUrl('import'), form).pipe(
      map((r) => {
        if (!r.success) throw new Error(r.error || 'Import failed');
        return r.data;
      })
    );
  }

  previewStatement(
    file: File,
    accountId?: number,
    bankHint?: string,
    pdfPassword?: string
  ): Observable<any> {
    const form = new FormData();
    form.append('file', file);
    if (accountId) form.append('account_id', String(accountId));
    if (bankHint) form.append('bank_hint', bankHint);
    if (pdfPassword) form.append('pdf_password', pdfPassword);
    return this.http.post<ApiResponse<any>>(bankApiUrl('import/preview'), form).pipe(
      map((r) => {
        if (!r.success) throw new Error(r.error || 'Preview failed');
        return r.data;
      })
    );
  }
}
