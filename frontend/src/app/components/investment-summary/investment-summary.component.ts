import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AnalyticsService } from '../../services/analytics.service';
import { ConfigService } from '../../services/config.service';
import { INVESTMENT_TYPES } from '../../constants/investment-types.constants';
import { hasMultiSelectFilter, matchesMultiSelect, pruneSelections } from '../../utils/advanced-filter.util';
import { matchesPlatformFilter } from '../../utils/ignore-platform.util';
import { ChartConfiguration, ChartOptions } from 'chart.js';

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
  selectedTypes: string[] = [];
  selectedSubTypes: string[] = [];
  selectedCategories: string[] = [];
  selectedPlatforms: string[] = [];
  minAmount: number | null = null;
  maxAmount: number | null = null;
  ignoreZeroAmount = false;
  showAdvancedFilters = false;
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
  investmentTypes: string[] = INVESTMENT_TYPES;
  platforms: string[] = [];
  subTypes: string[] = [];
  categories: string[] = [];

  typeChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  platformChartData: ChartConfiguration<'doughnut'>['data'] = {
    labels: [],
    datasets: [{
      data: [],
      backgroundColor: [
        'rgba(59, 130, 246, 0.85)',
        'rgba(16, 185, 129, 0.85)',
        'rgba(245, 158, 11, 0.85)',
        'rgba(239, 68, 68, 0.85)',
        'rgba(118, 75, 162, 0.85)',
        'rgba(14, 165, 233, 0.85)',
        'rgba(236, 72, 153, 0.85)',
        'rgba(34, 197, 94, 0.85)',
        'rgba(99, 102, 241, 0.85)',
        'rgba(244, 63, 94, 0.85)'
      ]
    }]
  };
  taxReportRows: Array<{ label: string; amount: number; count: number; percent: number }> = [];
  taxReportTotal = 0;

  barChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) =>
            `₹${(ctx.parsed.y ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        }
      }
    },
    scales: {
      y: {
        ticks: { callback: (v) => '₹' + Number(v).toLocaleString('en-IN') }
      }
    }
  };

  doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right' },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const value = Number(ctx.parsed) || 0;
            const total = (ctx.dataset.data as number[]).reduce((a, b) => a + (Number(b) || 0), 0);
            const pct = total > 0 ? (value / total) * 100 : 0;
            return `${ctx.label}: ₹${value.toLocaleString('en-IN')} (${pct.toFixed(1)}%)`;
          }
        }
      }
    }
  };

  constructor(
    private analyticsService: AnalyticsService,
    private configService: ConfigService
  ) {}

  ngOnInit() {
    this.configService.ensureLoaded().subscribe(() => {
      this.loadSummaryData();
    });
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
    this.platforms = [...new Set(this.summaryData.map(item => item.website_app_name))].filter(Boolean).sort();
    this.subTypes = [...new Set(this.summaryData.map(item => item.sub_type_name))].filter(Boolean).sort();
    this.categories = [...new Set(this.summaryData.map(item => item.sub_type_category))].filter(Boolean).sort();
  }

  get availableSubTypes(): string[] {
    let source = this.summaryData;
    if (this.selectedTypes.length) {
      source = source.filter(item => this.selectedTypes.includes(item.investment_type));
    }
    return [...new Set(source.map(item => item.sub_type_name))].filter(Boolean).sort();
  }

  get availableCategories(): string[] {
    let source = this.summaryData;
    if (this.selectedTypes.length) {
      source = source.filter(item => this.selectedTypes.includes(item.investment_type));
    }
    if (this.selectedSubTypes.length) {
      source = source.filter(item => this.selectedSubTypes.includes(item.sub_type_name));
    }
    return [...new Set(source.map(item => item.sub_type_category))].filter(Boolean).sort();
  }

  toggleAdvancedFilters() {
    this.showAdvancedFilters = !this.showAdvancedFilters;
  }

  hasActiveAdvancedFilters(): boolean {
    return !!(
      hasMultiSelectFilter(this.selectedTypes) ||
      hasMultiSelectFilter(this.selectedSubTypes) ||
      hasMultiSelectFilter(this.selectedCategories) ||
      hasMultiSelectFilter(this.selectedPlatforms) ||
      this.isPriceFilterActive() ||
      this.ignoreZeroAmount
    );
  }

  isPriceFilterActive(): boolean {
    return (this.minAmount !== null && this.minAmount !== undefined && !Number.isNaN(this.minAmount)) ||
      (this.maxAmount !== null && this.maxAmount !== undefined && !Number.isNaN(this.maxAmount));
  }

  onAdvancedTypeChange() {
    this.selectedSubTypes = pruneSelections(this.selectedSubTypes, this.availableSubTypes);
    this.selectedCategories = pruneSelections(this.selectedCategories, this.availableCategories);
    this.onFilterChange();
  }

  onAdvancedSubTypeChange() {
    this.selectedCategories = pruneSelections(this.selectedCategories, this.availableCategories);
    this.onFilterChange();
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

    if (this.selectedTypes.length) {
      result = result.filter(item => this.selectedTypes.includes(item.investment_type));
    }

    result = result.filter(item =>
      matchesPlatformFilter(
        item.website_app_name,
        this.selectedPlatforms,
        this.configService.getIgnorePlatforms()
      )
    );

    if (this.selectedCategories.length) {
      result = result.filter(item => matchesMultiSelect(this.selectedCategories, item.sub_type_category));
    }

    if (this.selectedSubTypes.length) {
      result = result.filter(item => matchesMultiSelect(this.selectedSubTypes, item.sub_type_name));
    }

    if (this.ignoreZeroAmount) {
      result = result.filter(item => item.amount !== 0);
    }

    if (this.minAmount !== null && this.minAmount !== undefined && !Number.isNaN(this.minAmount)) {
      result = result.filter(item => item.amount >= this.minAmount!);
    }

    if (this.maxAmount !== null && this.maxAmount !== undefined && !Number.isNaN(this.maxAmount)) {
      result = result.filter(item => item.amount <= this.maxAmount!);
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
    this.buildReportCharts();
    this.buildTaxReport();
  }

  exportCsv() {
    if (!this.filteredData.length) return;
    const headers = [
      'Platform',
      'Type',
      'Sub Type',
      'Category',
      'Amount',
      'Percent of Filtered',
      'Investment Date'
    ];
    const lines = this.filteredData.map((item) => [
      this.csvEscape(item.website_app_name || ''),
      this.csvEscape(item.investment_type || ''),
      this.csvEscape(item.sub_type_name || ''),
      this.csvEscape(item.sub_type_category || ''),
      Number(item.amount || 0).toFixed(2),
      this.getAmountPercentage(item.amount).toFixed(2),
      item.investment_date instanceof Date
        ? item.investment_date.toISOString().slice(0, 10)
        : String(item.investment_date || '')
    ].join(','));
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `investment-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private buildReportCharts() {
    const byType = new Map<string, number>();
    const byPlatform = new Map<string, number>();
    for (const item of this.filteredData) {
      const type = item.investment_type || 'Other';
      const platform = item.website_app_name || 'Other';
      const amount = Number(item.amount) || 0;
      byType.set(type, (byType.get(type) ?? 0) + amount);
      byPlatform.set(platform, (byPlatform.get(platform) ?? 0) + amount);
    }

    const typeSorted = [...byType.entries()].sort((a, b) => b[1] - a[1]);
    this.typeChartData = {
      labels: typeSorted.map(([k]) => k),
      datasets: [{
        label: 'Amount (₹)',
        data: typeSorted.map(([, v]) => v),
        backgroundColor: 'rgba(59, 130, 246, 0.7)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1
      }]
    };

    const platformSorted = [...byPlatform.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    this.platformChartData = {
      labels: platformSorted.map(([k]) => k),
      datasets: [{
        ...this.platformChartData.datasets[0],
        data: platformSorted.map(([, v]) => v)
      }]
    };
  }

  private buildTaxReport() {
    const taxLike = this.filteredData.filter((item) => {
      const blob = [
        item.investment_type,
        item.sub_type_name || '',
        item.sub_type_category || ''
      ].join(' ').toLowerCase();
      return blob.includes('tax') || blob.includes('elss') || blob.includes('ppf') || blob.includes('epf')
        || item.investment_type === 'PPF' || item.investment_type === 'EPF';
    });
    this.taxReportTotal = taxLike.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const map = new Map<string, { amount: number; count: number }>();
    for (const item of taxLike) {
      const label = item.sub_type_name || item.investment_type;
      const cur = map.get(label) || { amount: 0, count: 0 };
      cur.amount += Number(item.amount) || 0;
      cur.count += 1;
      map.set(label, cur);
    }
    this.taxReportRows = [...map.entries()]
      .map(([label, v]) => ({
        label,
        amount: v.amount,
        count: v.count,
        percent: this.taxReportTotal > 0 ? (v.amount / this.taxReportTotal) * 100 : 0
      }))
      .sort((a, b) => b.amount - a.amount);
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
    this.selectedTypes = [];
    this.selectedSubTypes = [];
    this.selectedCategories = [];
    this.selectedPlatforms = [];
    this.minAmount = null;
    this.maxAmount = null;
    this.ignoreZeroAmount = false;
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