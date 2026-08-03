import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { getApiBaseUrl } from '../utils/api-url.util';

export type AppConfig = {
  ignorePlatforms: string[];
  dbType?: string;
  database?: {
    host: string;
    port: number;
    user?: string;
    database?: string;
  };
  databasePreset?: string | null;
  databasePresets?: Array<{
    id: string;
    label: string;
    host: string;
    port: number;
    description?: string;
  }>;
};

@Injectable({
  providedIn: 'root'
})
export class ConfigService {
  private ignorePlatforms: string[] = [];
  private loaded = false;
  private load$?: Observable<string[]>;

  constructor(private http: HttpClient) {}

  getIgnorePlatforms(): string[] {
    return this.ignorePlatforms;
  }

  /** Load once and cache. Safe to call from multiple components. */
  ensureLoaded(): Observable<string[]> {
    if (this.loaded) {
      return of(this.ignorePlatforms);
    }
    if (!this.load$) {
      this.load$ = this.http.get<{ success: boolean; data: AppConfig }>(`${getApiBaseUrl()}/config`).pipe(
        map((response) => response?.data?.ignorePlatforms || []),
        tap((platforms) => {
          this.ignorePlatforms = platforms;
          this.loaded = true;
        }),
        catchError((error) => {
          console.error('Error loading app config:', error);
          this.ignorePlatforms = [];
          this.loaded = true;
          return of([]);
        }),
        shareReplay(1)
      );
    }
    return this.load$;
  }
}
