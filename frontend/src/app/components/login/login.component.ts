import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { normalizeApiDomain } from '../../utils/api-url.util';
import { firstValueFrom } from 'rxjs';

type DatabasePreset = {
  id: string;
  label: string;
  host: string;
  port: number;
  description?: string;
};

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent implements OnInit {
  username: string = '';
  password: string = '';
  apiDomain: string = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  errorMessage: string = '';
  loading: boolean = false;

  dbType: string = 'mysql';
  databasePresets: DatabasePreset[] = [];
  selectedDbPreset: string = 'localhost';
  currentDbHost: string = '';
  loadingDbConfig: boolean = false;

  constructor(
    private http: HttpClient,
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit() {
    const storedPreset = localStorage.getItem('dbPreset');
    if (storedPreset) {
      this.selectedDbPreset = storedPreset;
    }

    if (this.authService.isAuthenticated()) {
      const storedApiDomain = this.authService.getApiDomain();
      if (storedApiDomain) {
        this.apiDomain = storedApiDomain;
      }
      this.router.navigate(['/dashboard']);
      return;
    }

    this.loadDatabaseConfig();
  }

  onApiDomainBlur() {
    this.loadDatabaseConfig();
  }

  async loadDatabaseConfig() {
    this.apiDomain = normalizeApiDomain(this.apiDomain);
    this.loadingDbConfig = true;
    try {
      const response = await firstValueFrom(
        this.http.get<{
          success: boolean;
          data: {
            dbType?: string;
            database?: { host: string; port: number };
            databasePreset?: string | null;
            databasePresets?: DatabasePreset[];
          };
        }>(`${this.apiDomain}/api/config`)
      );

      this.dbType = response?.data?.dbType || 'mysql';
      this.databasePresets = response?.data?.databasePresets || [];
      this.currentDbHost = response?.data?.database
        ? `${response.data.database.host}:${response.data.database.port}`
        : '';

      const storedPreset = localStorage.getItem('dbPreset');
      if (storedPreset && this.databasePresets.some((p) => p.id === storedPreset)) {
        this.selectedDbPreset = storedPreset;
      } else if (response?.data?.databasePreset) {
        this.selectedDbPreset = response.data.databasePreset;
      } else if (this.databasePresets.length) {
        this.selectedDbPreset = this.databasePresets[0].id;
      }
    } catch {
      // API may be unreachable until user fixes URL; keep local fallbacks
      this.databasePresets = [
        {
          id: 'localhost',
          label: 'Localhost (host MySQL)',
          host: 'host.docker.internal',
          port: 3306,
          description: 'MySQL on the host machine'
        },
        {
          id: 'docker',
          label: 'Internal Docker DB',
          host: '127.0.0.1',
          port: 3306,
          description: 'Embedded MariaDB or compose db service'
        }
      ];
      this.currentDbHost = '';
    } finally {
      this.loadingDbConfig = false;
    }
  }

  login() {
    this.loading = true;
    this.errorMessage = '';
    this.apiDomain = normalizeApiDomain(this.apiDomain);

    if (this.username === 'amol' && this.password === 'admin') {
      this.testApiConnection()
        .then(() => this.applyDatabasePreset())
        .then(() => {
          this.authService.login(this.apiDomain);
          localStorage.setItem('dbPreset', this.selectedDbPreset);
          this.router.navigate(['/dashboard']);
        })
        .catch((err: Error) => {
          this.errorMessage =
            err?.message ||
            `Cannot connect to ${this.apiDomain}. Use full URL with protocol and port, e.g. http://your-domain.com:3000`;
          this.loading = false;
        });
    } else {
      this.errorMessage = 'Invalid username or password';
      this.loading = false;
    }
  }

  private async applyDatabasePreset(): Promise<void> {
    if (this.dbType === 'mongodb' || !this.selectedDbPreset) {
      return;
    }

    try {
      await firstValueFrom(
        this.http.post<{ success: boolean; error?: string }>(`${this.apiDomain}/api/config/database`, {
          preset: this.selectedDbPreset
        })
      );
    } catch (error: any) {
      const msg =
        error?.error?.error ||
        error?.message ||
        `Failed to switch to ${this.selectedDbPreset} database`;
      throw new Error(msg);
    }
  }

  private testApiConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error('API connection timeout'));
      }, 5000);

      const subscription = this.http.get(`${this.apiDomain}/api/health`).subscribe({
        next: () => {
          clearTimeout(timeout);
          resolve();
        },
        error: () => {
          clearTimeout(timeout);
          reject(
            new Error(
              `Cannot connect to ${this.apiDomain}. Use full URL with protocol and port, e.g. http://your-domain.com:3000`
            )
          );
        }
      });
    });
  }

  logout() {
    this.authService.logout();
    this.username = '';
    this.password = '';
    this.errorMessage = '';
  }
}
