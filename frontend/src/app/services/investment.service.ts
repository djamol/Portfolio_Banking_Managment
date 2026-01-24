import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

const API_URL = 'http://localhost:3000/api';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class InvestmentService {
  constructor(private http: HttpClient) {}

  getAll(): Observable<any[]> {
    return this.http.get<ApiResponse<any[]>>(`${API_URL}/investments`).pipe(
      map(response => response.success ? response.data : [])
    );
  }

  getById(id: number): Observable<any> {
    return this.http.get<ApiResponse<any>>(`${API_URL}/investments/${id}`).pipe(
      map(response => response.success ? response.data : null)
    );
  }

  create(data: any): Observable<any> {
    return this.http.post<ApiResponse<any>>(`${API_URL}/investments`, data).pipe(
      map(response => response.success ? response.data : null)
    );
  }

  update(id: number, data: any): Observable<any> {
    return this.http.put<ApiResponse<any>>(`${API_URL}/investments/${id}`, data).pipe(
      map(response => response.success ? response.data : null)
    );
  }

  delete(id: number): Observable<any> {
    return this.http.delete<ApiResponse<any>>(`${API_URL}/investments/${id}`).pipe(
      map(response => response.success ? response.data : null)
    );
  }
}