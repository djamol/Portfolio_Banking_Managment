import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { normalizeApiDomain } from '../../utils/api-url.util';
import { decryptJson, encryptJson } from '../../utils/storage-crypto.util';
import { firstValueFrom } from 'rxjs';

type DatabasePreset = {
  id: string;
  label: string;
  host: string;
  port: number;
  description?: string;
};

const DB_CUSTOM_STORAGE_KEY = 'dbCustomConfig';

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
  rememberMe: boolean = false;
  apiDomain: string = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  errorMessage: string = '';
  loading: boolean = false;

  dbType: string = 'mysql';
  databasePresets: DatabasePreset[] = [];
  selectedDbPreset: string = 'localhost';
  currentDbHost: string = '';
  loadingDbConfig: boolean = false;
  showAdvancedDb: boolean = false;

  // Custom / advanced MySQL fields
  dbHost: string = '127.0.0.1';
  dbPort: number = 3306;
  dbUser: string = 'root';
  dbPassword: string = '';
  dbName: string = 'portfolio';

  constructor(
    private http: HttpClient,
    private router: Router,
    private authService: AuthService
  ) {}

  async ngOnInit() {
    await this.restoreCustomDbConfig();
    await this.restoreRememberedLogin();

    const storedPreset = localStorage.getItem('dbPreset');
    if (storedPreset) {
      this.selectedDbPreset = storedPreset;
      if (storedPreset === 'custom') {
        this.showAdvancedDb = true;
      }
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

  private async restoreRememberedLogin() {
    const creds = await this.authService.loadRememberCredentials();
    if (!creds) return;
    this.rememberMe = true;
    this.username = creds.username;
    this.password = creds.password;
    this.apiDomain = normalizeApiDomain(creds.apiDomain);
  }

  onApiDomainBlur() {
    this.loadDatabaseConfig();
  }

  onDbPresetChange() {
    if (this.selectedDbPreset === 'custom') {
      this.showAdvancedDb = true;
      return;
    }

    const preset = this.databasePresets.find((p) => p.id === this.selectedDbPreset);
    if (preset) {
      this.dbHost = preset.host;
      this.dbPort = preset.port;
    }
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
            database?: {
              host: string;
              port: number;
              user?: string;
              database?: string;
            };
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

      const db = response?.data?.database;
      if (db) {
        // Prefill custom fields from live server config when not using saved custom
        if (this.selectedDbPreset !== 'custom' || !localStorage.getItem(DB_CUSTOM_STORAGE_KEY)) {
          this.dbHost = db.host;
          this.dbPort = db.port;
          if (db.user) this.dbUser = db.user;
          if (db.database) this.dbName = db.database;
        }
      }

      const storedPreset = localStorage.getItem('dbPreset');
      if (storedPreset === 'custom') {
        this.selectedDbPreset = 'custom';
        this.showAdvancedDb = true;
      } else if (storedPreset && this.databasePresets.some((p) => p.id === storedPreset)) {
        this.selectedDbPreset = storedPreset;
        this.onDbPresetChange();
      } else if (response?.data?.databasePreset) {
        this.selectedDbPreset = response.data.databasePreset;
        this.onDbPresetChange();
      } else if (this.databasePresets.length) {
        this.selectedDbPreset = this.databasePresets[0].id;
        this.onDbPresetChange();
      }
    } catch {
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
          description: 'Embedded MariaDB (no host port publish needed)'
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

    if (this.selectedDbPreset === 'custom' && !this.dbHost?.trim()) {
      this.errorMessage = 'Custom database host is required';
      this.loading = false;
      return;
    }

    if (!this.username?.trim() || !this.password) {
      this.errorMessage = 'Username and password are required';
      this.loading = false;
      return;
    }

    this.authService
      .loginRemote(this.username.trim(), this.password, this.apiDomain, this.rememberMe)
      .subscribe({
        next: () => {
          this.testApiConnection()
            .then(() => this.applyDatabaseConfig())
            .then(async () => {
              localStorage.setItem('dbPreset', this.selectedDbPreset);
              await this.persistCustomDbConfig();
              this.router.navigate(['/dashboard']);
            })
            .catch((err: Error) => {
              this.errorMessage =
                err?.message ||
                `Cannot connect to ${this.apiDomain}. Use full URL with protocol and port, e.g. http://your-domain.com:3000`;
              this.loading = false;
            });
        },
        error: (err) => {
          this.errorMessage =
            err?.error?.error || err?.message || 'Invalid username or password';
          this.loading = false;
        }
      });
  }

  private async applyDatabaseConfig(): Promise<void> {
    if (this.dbType === 'mongodb') {
      return;
    }

    const body: {
      host?: string;
      port?: number;
      user?: string;
      password?: string;
      database?: string;
      preset?: string;
    } = {};

    if (this.selectedDbPreset === 'custom') {
      body.host = this.dbHost.trim();
      body.port = Number(this.dbPort) || 3306;
      body.user = this.dbUser.trim() || 'root';
      body.password = this.dbPassword;
      body.database = this.dbName.trim() || 'portfolio';
    } else {
      body.preset = this.selectedDbPreset;
      // Optional advanced overrides on top of preset host/port
      if (this.showAdvancedDb) {
        if (this.dbUser?.trim()) body.user = this.dbUser.trim();
        if (this.dbPassword !== '') body.password = this.dbPassword;
        if (this.dbName?.trim()) body.database = this.dbName.trim();
      }
    }

    try {
      await firstValueFrom(
        this.http.post<{ success: boolean; error?: string }>(
          `${this.apiDomain}/api/config/database`,
          body
        )
      );
    } catch (error: any) {
      const msg =
        error?.error?.error ||
        error?.message ||
        `Failed to apply database configuration`;
      throw new Error(msg);
    }
  }

  private async persistCustomDbConfig() {
    const payload = {
      host: this.dbHost,
      port: this.dbPort,
      user: this.dbUser,
      password: this.dbPassword,
      database: this.dbName,
      showAdvancedDb: this.showAdvancedDb
    };
    try {
      const encrypted = await encryptJson(payload);
      localStorage.setItem(DB_CUSTOM_STORAGE_KEY, encrypted);
    } catch {
      // Fall back to nothing rather than writing plaintext credentials
      localStorage.removeItem(DB_CUSTOM_STORAGE_KEY);
    }
  }

  private async restoreCustomDbConfig() {
    try {
      const raw = localStorage.getItem(DB_CUSTOM_STORAGE_KEY);
      if (!raw) return;
      const parsed = await decryptJson<{
        host?: string;
        port?: number | string;
        user?: string;
        password?: string;
        database?: string;
        showAdvancedDb?: boolean;
      }>(raw);
      if (!parsed) return;
      if (parsed.host) this.dbHost = parsed.host;
      if (parsed.port) this.dbPort = Number(parsed.port) || 3306;
      if (parsed.user) this.dbUser = parsed.user;
      if (parsed.password != null) this.dbPassword = parsed.password;
      if (parsed.database) this.dbName = parsed.database;
      if (parsed.showAdvancedDb) this.showAdvancedDb = !!parsed.showAdvancedDb;
      // Re-encrypt legacy plaintext on restore
      if (!raw.startsWith('enc:v1:')) {
        await this.persistCustomDbConfig();
      }
    } catch {
      // ignore corrupt storage
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
