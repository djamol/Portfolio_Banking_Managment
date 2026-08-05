import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ApiResponse } from './banking.models';
import { bankApiUrl } from './bank-api.util';

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
    opts: { format?: 'xlsx' | 'pdf' | 'csv'; layout?: 'statement' | 'raw' } = {}
  ): Observable<Blob> {
    let params = new HttpParams()
      .set('format', opts.format || 'xlsx')
      .set('layout', opts.layout || 'statement');
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
    });
    return this.http.get(bankApiUrl('export/transactions'), {
      params,
      responseType: 'blob'
    });
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
