import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AnalyticsService } from '../../services/analytics.service';

@Component({
  selector: 'app-investment-summary',
  templateUrl: './investment-summary.component.html',
  styleUrls: ['./investment-summary.component.css'],
  standalone: false
})
export class InvestmentSummaryComponent implements OnInit {
  summaryData: any[] = [];
  filteredData: any[] = [];
  /** Sum of amount for all rows matching current filters (not paginated). */
  filteredTotalAmount = 0;
  loading = false;
  errorMessage = '';

  // Search and filter properties
  searchTerm: string = '';
  selectedType: string = '';
  selectedPlatform: string = '';
  selectedCategory: string = '';
  sortBy: string = 'amount';
  sortDirection: 'asc' | 'desc' = 'desc';

  // Pagination properties
  currentPage: number = 1;
  itemsPerPage: number = 10;
  totalPages: number = 0;
  paginatedData: any[] = [];

  // History properties
  showHistory: boolean = false;
  selectedInvestmentHistory: any[] = [];
  selectedInvestmentName: string = '';
  historyLoading: boolean = false;

  // Unique values for filters
  investmentTypes: string[] = [];
  platforms: string[] = [];
  categories: string[] = [];

  constructor(private analyticsService: AnalyticsService) {}

  ngOnInit() {
    this.loadSummaryData();
  }

  loadSummaryData() {
    this.loading = true;
    this.errorMessage = '';

    this.analyticsService.getSummaryTable().subscribe({
      next: (response) => {
        if (response.data) {
          this.summaryData = response.data.map(item => ({
            ...item,
            amount: parseFloat(item.amount) || 0,
            investment_date: new Date(item.investment_date)
          }));
          this.extractFilterOptions();
          this.applyFilters();
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading summary table:', error);
        this.errorMessage = 'Failed to load investment summary. ' + (error.message || 'Please check if backend is running.');
        this.loading = false;
      }
    });
  }

  extractFilterOptions() {
    // Extract unique investment types
    this.investmentTypes = [...new Set(this.summaryData.map(item => item.investment_type))].filter(Boolean);

    // Extract unique platforms
    this.platforms = [...new Set(this.summaryData.map(item => item.website_app_name))].filter(Boolean);

    // Extract unique categories
    this.categories = [...new Set(this.summaryData.map(item => item.sub_type_category))].filter(Boolean);
  }

  applyFilters() {
    // Apply search term filter
    let result = this.summaryData.filter(item => {
      const searchStr = this.searchTerm.toLowerCase();
      return (
        !this.searchTerm ||
        item.website_app_name.toLowerCase().includes(searchStr) ||
        item.investment_type.toLowerCase().includes(searchStr) ||
        (item.sub_type_name && item.sub_type_name.toLowerCase().includes(searchStr)) ||
        (item.sub_type_category && item.sub_type_category.toLowerCase().includes(searchStr)) ||
        item.amount.toString().includes(searchStr) ||
        item.investment_date.toISOString().toLowerCase().includes(searchStr)
      );
    });

    // Apply type filter
    if (this.selectedType) {
      result = result.filter(item => item.investment_type === this.selectedType);
    }

    // Apply platform filter
    if (this.selectedPlatform) {
      result = result.filter(item => item.website_app_name === this.selectedPlatform);
    }

    // Apply category filter
    if (this.selectedCategory) {
      result = result.filter(item => item.sub_type_category === this.selectedCategory);
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;
      switch (this.sortBy) {
        case 'amount':
        case 'percentage':
          comparison = a.amount - b.amount;
          break;
        case 'investment_type':
          comparison = a.investment_type.localeCompare(b.investment_type);
          break;
        case 'website_app_name':
          comparison = a.website_app_name.localeCompare(b.website_app_name);
          break;
        case 'sub_type_name':
          comparison = (a.sub_type_name || '').localeCompare(b.sub_type_name || '');
          break;
        case 'sub_type_category':
          comparison = (a.sub_type_category || '').localeCompare(b.sub_type_category || '');
          break;
        case 'investment_date':
          comparison = a.investment_date.getTime() - b.investment_date.getTime();
          break;
        default:
          comparison = 0;
      }
      return this.sortDirection === 'asc' ? comparison : -comparison;
    });

    this.filteredData = result;
    this.filteredTotalAmount = result.reduce(
      (sum, item) => sum + (Number(item.amount) || 0),
      0
    );
    this.calculatePagination();
    this.updatePaginatedData();
  }

  calculatePagination() {
    this.totalPages = Math.ceil(this.filteredData.length / this.itemsPerPage);
    if (this.currentPage > this.totalPages && this.totalPages > 0) {
      this.currentPage = this.totalPages;
    }
  }

  updatePaginatedData() {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    this.paginatedData = this.filteredData.slice(startIndex, endIndex);
  }

  onPageChange(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.updatePaginatedData();
    }
  }

  onItemsPerPageChange() {
    this.currentPage = 1; // Reset to first page when changing items per page
    this.calculatePagination();
    this.updatePaginatedData();
  }

  onSearchChange() {
    this.currentPage = 1; // Reset to first page when searching
    this.applyFilters();
  }

  onFilterChange() {
    this.currentPage = 1; // Reset to first page when filtering
    this.applyFilters();
  }

  onSort(column: string) {
    if (this.sortBy === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = column;
      this.sortDirection = 'desc'; // Default to descending for new sorts
    }
    this.applyFilters();
  }

  getSortIcon(column: string) {
    if (this.sortBy !== column) {
      return '↕️';
    }
    return this.sortDirection === 'asc' ? '↑' : '↓';
  }

  clearFilters() {
    this.searchTerm = '';
    this.selectedType = '';
    this.selectedPlatform = '';
    this.selectedCategory = '';
    this.sortBy = 'amount';
    this.sortDirection = 'desc';
    this.currentPage = 1;
    this.applyFilters();
  }

  formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  // Helper method for calculating min value in template
  getMin(a: number, b: number): number {
    return Math.min(a, b);
  }

  /** Share of row amount relative to the current filtered total. */
  getAmountPercentage(amount: number): number {
    if (!this.filteredTotalAmount) {
      return 0;
    }
    return (Number(amount) / this.filteredTotalAmount) * 100;
  }

  // Method to show history for an investment
  showInvestmentHistory(item: any) {
    this.historyLoading = true;
    this.selectedInvestmentName = `${item.website_app_name} - ${item.investment_type}`;
    
    // Call the API to get the actual history
    this.analyticsService.getInvestmentHistory(item.id).subscribe({
      next: (response) => {
        if (response.data && response.data.length > 0) {
          // Sort by date descending (most recent first)
          const sortedHistory = response.data.sort((a, b) => new Date(b.change_date).getTime() - new Date(a.change_date).getTime());
          
          // Calculate differences between consecutive records
          const enhancedHistory = sortedHistory.map((record, index) => {
            const currentAmount = parseFloat(record.amount) || 0;
            
            // Calculate difference compared to previous record (older date)
            let previousAmount = 0;
            let difference = 0;
            
            // Look for the next record in the sorted list (which is older)
            if (index < sortedHistory.length - 1) {
              const previousRecord = sortedHistory[index + 1];
              previousAmount = parseFloat(previousRecord.amount) || 0;
              difference = currentAmount - previousAmount;
            }
            
            return {
              ...record,
              change_date: new Date(record.change_date),
              amount: currentAmount,
              difference: difference,
              differencePercentage: previousAmount !== 0 ? ((Math.abs(difference) / previousAmount) * 100) : 0,
              isIncrease: difference > 0,
              isDecrease: difference < 0
            };
          });
          
          this.selectedInvestmentHistory = enhancedHistory;
        } else {
          // If no history found, show a message
          this.selectedInvestmentHistory = [{
            id: 0,
            change_type: 'info',
            amount: item.amount,
            change_date: item.investment_date,
            notes: 'No history records found for this investment.',
            difference: 0,
            differencePercentage: 0,
            isIncrease: false,
            isDecrease: false
          }];
        }
        this.showHistory = true;
        this.historyLoading = false;
      },
      error: (error) => {
        console.error('Error loading investment history:', error);
        // Show a fallback message
        this.selectedInvestmentHistory = [{
          id: 0,
          change_type: 'error',
          amount: item.amount,
          change_date: item.investment_date,
          notes: 'Failed to load history data. Please try again later.',
          difference: 0,
          differencePercentage: 0,
          isIncrease: false,
          isDecrease: false
        }];
        this.showHistory = true;
        this.historyLoading = false;
      }
    });
  }

  closeHistory() {
    this.showHistory = false;
    this.selectedInvestmentHistory = [];
    this.selectedInvestmentName = '';
    this.historyLoading = false;
  }
}