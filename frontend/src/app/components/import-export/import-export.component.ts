import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { getApiBaseUrl } from '../../utils/api-url.util';

type MessageType = 'success' | 'error' | 'info';

@Component({
  selector: 'app-import-export',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './import-export.component.html',
  styleUrl: './import-export.component.css'
})
export class ImportExportComponent {
  loading = false;
  message = '';
  messageType: MessageType = 'info';
  sqlImportMode: 'merge' | 'fresh' = 'merge';
  mongoImportMode: 'merge' | 'fresh' = 'merge';
  pendingSqlFile: File | null = null;
  pendingMongoFile: File | null = null;

  constructor(private http: HttpClient) {}

  private get apiUrl(): string {
    return getApiBaseUrl();
  }

  exportCsv() {
    this.loading = true;
    this.showMessage('Exporting CSV...', 'info');

    this.http.get(`${this.apiUrl}/portfolio/export`).subscribe({
      next: (response: any) => {
        if (response.success && response.data?.length) {
          const csvContent = this.convertToCSV(response.data);
          this.downloadFile(
            csvContent,
            `portfolio_data_${this.today()}.csv`,
            'text/csv;charset=utf-8;'
          );
          this.showMessage('CSV export completed successfully!', 'success');
        } else {
          this.showMessage('No data to export', 'error');
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('CSV export error:', error);
        this.showMessage('CSV export failed: ' + this.errorText(error), 'error');
        this.loading = false;
      }
    });
  }

  exportSql() {
    this.loading = true;
    this.showMessage('Exporting SQL...', 'info');

    this.http.get(`${this.apiUrl}/portfolio/export/sql`, { responseType: 'text' }).subscribe({
      next: (sql) => {
        if (!sql?.trim()) {
          this.showMessage('No SQL data to export', 'error');
          this.loading = false;
          return;
        }
        this.downloadFile(sql, `portfolio_export_${this.today()}.sql`, 'application/sql;charset=utf-8;');
        this.showMessage('SQL export completed successfully!', 'success');
        this.loading = false;
      },
      error: (error) => {
        console.error('SQL export error:', error);
        this.showMessage('SQL export failed: ' + this.errorText(error), 'error');
        this.loading = false;
      }
    });
  }

  exportMongo() {
    this.loading = true;
    this.showMessage('Exporting MongoDB JSON...', 'info');

    this.http.get(`${this.apiUrl}/portfolio/export/mongo`, { responseType: 'text' }).subscribe({
      next: (json) => {
        if (!json?.trim()) {
          this.showMessage('No MongoDB data to export', 'error');
          this.loading = false;
          return;
        }
        this.downloadFile(json, `portfolio_export_${this.today()}.mongo.json`, 'application/json;charset=utf-8;');
        this.showMessage('MongoDB export completed successfully!', 'success');
        this.loading = false;
      },
      error: (error) => {
        console.error('MongoDB export error:', error);
        this.showMessage('MongoDB export failed: ' + this.errorText(error), 'error');
        this.loading = false;
      }
    });
  }

  importCsv(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      this.showMessage('Please select a CSV file', 'error');
      input.value = '';
      return;
    }

    this.loading = true;
    this.showMessage('Processing CSV file...', 'info');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsedData = this.parseImportCSV(String(e.target?.result || ''));
        if (!parsedData.length) {
          this.showMessage('No valid data found in CSV file', 'error');
          this.loading = false;
          input.value = '';
          return;
        }

        this.http.post(`${this.apiUrl}/portfolio/import`, parsedData).subscribe({
          next: (response: any) => {
            if (response.success) {
              const result = response.data;
              this.showMessage(
                `CSV import completed: ${result.imported} added, ${result.updated} updated.`,
                'success'
              );
            } else {
              this.showMessage('CSV import failed: ' + (response.error || 'Unknown error'), 'error');
            }
            this.loading = false;
            input.value = '';
          },
          error: (error) => {
            console.error('CSV import error:', error);
            this.showMessage('CSV import failed: ' + this.errorText(error), 'error');
            this.loading = false;
            input.value = '';
          }
        });
      } catch (error) {
        console.error('CSV parsing error:', error);
        this.showMessage('Error parsing CSV file: ' + (error as Error).message, 'error');
        this.loading = false;
        input.value = '';
      }
    };
    reader.readAsText(file);
  }

  onSqlFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.sql')) {
      this.showMessage('Please select a .sql file', 'error');
      input.value = '';
      return;
    }

    this.pendingSqlFile = file;

    if (this.sqlImportMode === 'fresh') {
      const confirmed = window.confirm(
        'Fresh install will DELETE ALL existing data from all portfolio tables before importing.\n\nThis cannot be undone. Continue?'
      );
      if (!confirmed) {
        this.pendingSqlFile = null;
        input.value = '';
        return;
      }
    }

    this.importSqlFile(file, input);
  }

  private importSqlFile(file: File, input: HTMLInputElement) {
    this.loading = true;
    this.showMessage(
      this.sqlImportMode === 'fresh' ? 'Running fresh SQL install...' : 'Importing SQL (merge mode)...',
      'info'
    );

    const reader = new FileReader();
    reader.onload = (e) => {
      const sql = String(e.target?.result || '');
      if (!sql.trim()) {
        this.showMessage('SQL file is empty', 'error');
        this.loading = false;
        input.value = '';
        this.pendingSqlFile = null;
        return;
      }

      this.http.post(`${this.apiUrl}/portfolio/import/sql`, {
        sql,
        freshInstall: this.sqlImportMode === 'fresh'
      }).subscribe({
        next: (response: any) => {
          if (response.success) {
            const result = response.data;
            const counts = result.tableCounts
              ? Object.entries(result.tableCounts).map(([t, c]) => `${t}: ${c}`).join(', ')
              : '';
            this.showMessage(
              `${response.message || 'SQL import completed.'} Rows — ${counts}`,
              result.errors?.length ? 'info' : 'success'
            );
            if (result.errors?.length) {
              console.warn('SQL import warnings:', result.errors);
            }
          } else {
            this.showMessage('SQL import failed: ' + (response.error || 'Unknown error'), 'error');
          }
          this.loading = false;
          input.value = '';
          this.pendingSqlFile = null;
        },
        error: (error) => {
          console.error('SQL import error:', error);
          this.showMessage('SQL import failed: ' + this.errorText(error), 'error');
          this.loading = false;
          input.value = '';
          this.pendingSqlFile = null;
        }
      });
    };

    reader.onerror = () => {
      this.showMessage('Failed to read SQL file', 'error');
      this.loading = false;
      input.value = '';
      this.pendingSqlFile = null;
    };

    reader.readAsText(file);
  }

  onMongoFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.json')) {
      this.showMessage('Please select a .json or .mongo.json file', 'error');
      input.value = '';
      return;
    }

    this.pendingMongoFile = file;

    if (this.mongoImportMode === 'fresh') {
      const confirmed = window.confirm(
        'Fresh install will DELETE ALL existing data from all portfolio collections before importing.\n\nThis cannot be undone. Continue?'
      );
      if (!confirmed) {
        this.pendingMongoFile = null;
        input.value = '';
        return;
      }
    }

    this.importMongoFile(file, input);
  }

  private importMongoFile(file: File, input: HTMLInputElement) {
    this.loading = true;
    this.showMessage(
      this.mongoImportMode === 'fresh' ? 'Running fresh MongoDB install...' : 'Importing MongoDB (merge mode)...',
      'info'
    );

    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = String(e.target?.result || '');
      if (!raw.trim()) {
        this.showMessage('MongoDB file is empty', 'error');
        this.loading = false;
        input.value = '';
        this.pendingMongoFile = null;
        return;
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        this.showMessage('Invalid JSON file', 'error');
        this.loading = false;
        input.value = '';
        this.pendingMongoFile = null;
        return;
      }

      this.http.post(`${this.apiUrl}/portfolio/import/mongo`, {
        data,
        freshInstall: this.mongoImportMode === 'fresh'
      }).subscribe({
        next: (response: any) => {
          if (response.success) {
            const result = response.data;
            const counts = result.tableCounts
              ? Object.entries(result.tableCounts).map(([t, c]) => `${t}: ${c}`).join(', ')
              : '';
            this.showMessage(
              `${response.message || 'MongoDB import completed.'} Rows — ${counts}`,
              result.errors?.length ? 'info' : 'success'
            );
            if (result.errors?.length) {
              console.warn('MongoDB import warnings:', result.errors);
            }
          } else {
            this.showMessage('MongoDB import failed: ' + (response.error || 'Unknown error'), 'error');
          }
          this.loading = false;
          input.value = '';
          this.pendingMongoFile = null;
        },
        error: (error) => {
          console.error('MongoDB import error:', error);
          this.showMessage('MongoDB import failed: ' + this.errorText(error), 'error');
          this.loading = false;
          input.value = '';
          this.pendingMongoFile = null;
        }
      });
    };

    reader.onerror = () => {
      this.showMessage('Failed to read MongoDB file', 'error');
      this.loading = false;
      input.value = '';
      this.pendingMongoFile = null;
    };

    reader.readAsText(file);
  }

  private downloadFile(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private today(): string {
    return new Date().toISOString().split('T')[0];
  }

  private errorText(error: any): string {
    return error?.error?.error || error?.message || 'Unknown error';
  }

  private convertToCSV(data: any[]): string {
    const headers = [
      'ID', 'Website/App Name', 'Investment Type', 'Sub Type Name',
      'Sub Type Category', 'Amount', 'Investment Date', 'Notes', 'Created At', 'Updated At'
    ];

    const rows = data.map((item) => [
      item.id,
      `"${item.website_app_name || ''}"`,
      `"${item.investment_type || ''}"`,
      `"${item.sub_type_name || ''}"`,
      `"${item.sub_type_category || ''}"`,
      item.amount,
      item.investment_date,
      `"${item.notes || ''}"`,
      item.created_at,
      item.updated_at
    ]);

    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  }

  private parseImportCSV(csvText: string): any[] {
    const lines = csvText.split('\n');
    const result: any[] = [];
    if (lines.length < 2) return result;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = this.parseCSVLine(line);
      if (fields.length < 7) continue;

      const investment = {
        website_app_name: fields[1]?.replace(/^"|"$/g, '')?.trim(),
        investment_type: fields[2]?.replace(/^"|"$/g, '')?.trim(),
        sub_type_name: fields[3]?.replace(/^"|"$/g, '')?.trim() || null,
        sub_type_category: fields[4]?.replace(/^"|"$/g, '')?.trim() || null,
        amount: parseFloat(fields[5]) || 0,
        investment_date: fields[6]?.trim(),
        notes: fields[7]?.replace(/^"|"$/g, '')?.trim() || null
      };

      if (investment.website_app_name && investment.investment_type &&
          investment.amount > 0 && investment.investment_date) {
        result.push(investment);
      }
    }

    return result;
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  private showMessage(msg: string, type: MessageType) {
    this.message = msg;
    this.messageType = type;
    setTimeout(() => {
      if (this.message === msg) {
        this.message = '';
      }
    }, 8000);
  }
}
