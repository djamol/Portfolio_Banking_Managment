import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SubTypeName {
  id?: number;
  name: string;
  investment_type: string;
}

export interface Category {
  id?: number;
  category: string;
  sub_type_name_id: number | null;
  investment_type: string;
  sub_type_name?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CategoryService {
  private apiUrl = '/api/categories';

  constructor(private http: HttpClient) {}

  // Sub-type names APIs
  getSubTypeNames(): Observable<{ success: boolean; data: SubTypeName[] }> {
    return this.http.get<{ success: boolean; data: SubTypeName[] }>(`${this.apiUrl}/sub-type-names`);
  }

  getSubTypeNamesByInvestmentType(investmentType: string): Observable<{ success: boolean; data: SubTypeName[] }> {
    return this.http.get<{ success: boolean; data: SubTypeName[] }>(`${this.apiUrl}/sub-type-names/${investmentType}`);
  }

  createSubTypeName(subTypeName: SubTypeName): Observable<{ success: boolean; data: SubTypeName }> {
    return this.http.post<{ success: boolean; data: SubTypeName }>(`${this.apiUrl}/sub-type-names`, subTypeName);
  }

  deleteSubTypeName(id: number): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.apiUrl}/sub-type-names/${id}`);
  }

  // Categories APIs
  getAllCategories(): Observable<{ success: boolean; data: Category[] }> {
    return this.http.get<{ success: boolean; data: Category[] }>(`${this.apiUrl}/categories`);
  }

  getCategories(investmentType: string, subTypeNameId?: number): Observable<{ success: boolean; data: Category[] }> {
    if (investmentType === 'all') {
      // Return all categories regardless of investment type
      return this.getAllCategories();
    }
    const url = subTypeNameId 
      ? `${this.apiUrl}/categories/${investmentType}/${subTypeNameId}`
      : `${this.apiUrl}/categories/${investmentType}`;
    return this.http.get<{ success: boolean; data: Category[] }>(url);
  }

  createCategory(category: Category): Observable<{ success: boolean; data: Category }> {
    return this.http.post<{ success: boolean; data: Category }>(`${this.apiUrl}/categories`, category);
  }

  deleteCategory(id: number): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.apiUrl}/categories/${id}`);
  }
}