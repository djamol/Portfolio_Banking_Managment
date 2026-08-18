import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { InvestmentService } from '../../services/investment.service';
import { AnalyticsService } from '../../services/analytics.service';
import { CategoryService, SubTypeName, Category } from '../../services/category.service';
import { ConfigService } from '../../services/config.service';
import { INVESTMENT_TYPES, INVESTMENT_SUB_TYPES } from '../../constants/investment-types.constants';
import { hasMultiSelectFilter, matchesMultiSelect, pruneSelections } from '../../utils/advanced-filter.util';
import { matchesPlatformFilter } from '../../utils/ignore-platform.util';
import { getApiDomain } from '../../utils/api-url.util';
import { formatIndianFull, getIndianAmountBreakdown } from '../../utils/indian-number.util';
import {
  parseMaturityDateFromNotes,
  setMaturityDateInNotes,
  showsMaturityHelper
} from '../../utils/maturity-notes.util';

@Component({
  selector: 'app-investment-list',
  templateUrl: './investment-list.component.html',
  styleUrls: ['./investment-list.component.css'],
  standalone: false
})
export class InvestmentListComponent implements OnInit {
  investments: any[] = [];
  filteredInvestments: any[] = [];
  loading = false;
  errorMessage = '';
  apiDomain = getApiDomain();

  // Search and filter properties
  searchTerm: string = '';
  selectedTypes: string[] = [];
  selectedSubTypes: string[] = [];
  selectedCategories: string[] = [];
  selectedPlatforms: string[] = [];
  minAmount: number | null = null;
  maxAmount: number | null = null;
  dateFrom: string = '';
  dateTo: string = '';
  ignoreZeroAmount = false;
  showAdvancedFilters = false;
  sortBy: string = 'investment_date';
  sortDirection: 'asc' | 'desc' = 'desc';
  selectedIds = new Set<number>();
  flashMessage = '';
  flashType: 'success' | 'error' | 'info' = 'info';
  saving = false;
  bulkWorking = false;
  originalEditDate = '';
  duplicateMatches: any[] = [];
  maturityDate = '';
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  showBulkReclassify = false;
  bulkWorkingReclassify = false;
  bulkForm = this.emptyBulkForm();
  bulkSubTypes: string[] = [];
  bulkCategories: string[] = [];

  // Pagination properties
  currentPage: number = 1;
  itemsPerPage: number = 10;
  totalPages: number = 0;
  paginatedData: any[] = [];
  visiblePageNumbers: number[] = [];

  // Unique values for filters
  investmentTypes: string[] = INVESTMENT_TYPES;
  platforms: string[] = [];
  subTypes: string[] = [];
  categories: string[] = [];

  // Modal properties
  showModal = false;
  isEditing = false;
  currentInvestment: any = {
    id: null,
    website_app_name: '',
    investment_type: '',
    sub_type_name: '',
    sub_type_category: '',
    amount: 0,
    investment_date: new Date().toISOString().split('T')[0],
    notes: ''
  };

  // Dynamic sub-types and categories
  investmentSubTypes: string[] = [];
  investmentCategories: string[] = [];
  
  // Database stored options
  dbSubTypeNames: SubTypeName[] = [];
  dbCategories: Category[] = [];

  // Track if user wants to add new sub-type or category
  showNewSubTypeInput = false;
  showNewCategoryInput = false;
  newSubType = '';
  newCategory = '';

  // History modal properties
  showHistoryModal = false;
  historyData: any[] = [];
  currentInvestmentName = '';
  historyLoading = false;

  constructor(
    private investmentService: InvestmentService,
    private categoryService: CategoryService,
    private analyticsService: AnalyticsService,
    private configService: ConfigService
  ) {}

  ngOnInit() {
    this.configService.ensureLoaded().subscribe(() => {
      this.loadDatabaseOptions();
      this.loadInvestments();
    });
  }

  loadDatabaseOptions() {
    // Load all sub-type names from database
    this.categoryService.getSubTypeNames().subscribe({
      next: (response) => {
        if (response.success) {
          this.dbSubTypeNames = response.data;
        }
      },
      error: (error) => {
        console.error('Error loading sub-type names:', error);
      }
    });

    // Load all categories from database
    this.categoryService.getAllCategories().subscribe({
      next: (response) => {
        if (response.success) {
          this.dbCategories = response.data;
        }
      },
      error: (error) => {
        console.error('Error loading categories:', error);
      }
    });
  }

  loadInvestments() {
    this.loading = true;
    this.errorMessage = '';

    // Use the summary table API which includes history counts
    this.analyticsService.getSummaryTable().subscribe({
      next: (response) => {
        if (response.data) {
          this.investments = response.data.map(item => ({
            ...item,
            amount: parseFloat(item.amount) || 0,
            investment_date: new Date(item.investment_date),
            history_count: item.history_count || 0
          }));
          this.selectedIds = new Set();
          this.extractFilterOptions();
          this.applyFilters();
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading investments:', error);
        this.errorMessage = 'Failed to load investments. ' + (error.message || 'Please check if backend is running.');
        this.loading = false;
      }
    });
  }

  extractFilterOptions() {
    this.platforms = [...new Set(this.investments.map(item => item.website_app_name))].filter(Boolean).sort();
    this.subTypes = [...new Set(this.investments.map(item => item.sub_type_name))].filter(Boolean).sort();
    this.categories = [...new Set(this.investments.map(item => item.sub_type_category))].filter(Boolean).sort();
  }

  get availableSubTypes(): string[] {
    let source = this.investments;
    if (this.selectedTypes.length) {
      source = source.filter(item => this.selectedTypes.includes(item.investment_type));
    }
    return [...new Set(source.map(item => item.sub_type_name))].filter(Boolean).sort();
  }

  get availableCategories(): string[] {
    let source = this.investments;
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
      this.isDateFilterActive() ||
      this.ignoreZeroAmount
    );
  }

  isDateFilterActive(): boolean {
    return !!(this.dateFrom || this.dateTo);
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
    let result = this.investments.filter(item => {
      const searchStr = this.searchTerm.toLowerCase();
      return (
        !this.searchTerm ||
        (item.website_app_name || '').toLowerCase().includes(searchStr) ||
        (item.investment_type || '').toLowerCase().includes(searchStr) ||
        (item.sub_type_name && item.sub_type_name.toLowerCase().includes(searchStr)) ||
        (item.sub_type_category && item.sub_type_category.toLowerCase().includes(searchStr)) ||
        (item.notes && item.notes.toLowerCase().includes(searchStr)) ||
        item.amount.toString().includes(searchStr) ||
        this.toLocalYmd(item.investment_date).includes(searchStr)
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

    if (this.selectedSubTypes.length) {
      result = result.filter(item => matchesMultiSelect(this.selectedSubTypes, item.sub_type_name));
    }

    if (this.selectedCategories.length) {
      result = result.filter(item => matchesMultiSelect(this.selectedCategories, item.sub_type_category));
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

    if (this.dateFrom) {
      result = result.filter(item => this.toLocalYmd(item.investment_date) >= this.dateFrom);
    }
    if (this.dateTo) {
      result = result.filter(item => this.toLocalYmd(item.investment_date) <= this.dateTo);
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;
      switch (this.sortBy) {
        case 'amount':
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

    this.filteredInvestments = result;
    this.pruneSelectionToFiltered();
    this.calculatePagination();
    this.updatePaginatedData();
  }

  calculatePagination() {
    this.totalPages = Math.ceil(this.filteredInvestments.length / this.itemsPerPage);
    if (this.currentPage > this.totalPages && this.totalPages > 0) {
      this.currentPage = this.totalPages;
    }
    this.visiblePageNumbers = this.computeVisiblePages();
  }

  updatePaginatedData() {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    this.paginatedData = this.filteredInvestments.slice(startIndex, endIndex);
  }

  onPageChange(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.visiblePageNumbers = this.computeVisiblePages();
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
    this.dateFrom = '';
    this.dateTo = '';
    this.ignoreZeroAmount = false;
    this.sortBy = 'investment_date';
    this.sortDirection = 'desc';
    this.currentPage = 1;
    this.applyFilters();
  }

  openAddModal() {
    this.currentInvestment = {
      id: null,
      website_app_name: '',
      investment_type: '',
      sub_type_name: '',
      sub_type_category: '',
      amount: 0,
      investment_date: this.todayYmd(),
      notes: ''
    };
    this.isEditing = false;
    this.showModal = true;
    this.originalEditDate = '';
    this.duplicateMatches = [];
    
    // Reset dynamic options
    this.investmentSubTypes = [];
    this.investmentCategories = [];
    this.showNewSubTypeInput = false;
    this.showNewCategoryInput = false;
    this.newSubType = '';
    this.newCategory = '';
    this.maturityDate = '';
  }

  get showMaturityHelper(): boolean {
    return showsMaturityHelper(this.currentInvestment.investment_type);
  }

  onMaturityDateChange() {
    this.currentInvestment.notes = setMaturityDateInNotes(this.currentInvestment.notes, this.maturityDate || null);
  }

  private syncMaturityFromNotes() {
    this.maturityDate = parseMaturityDateFromNotes(this.currentInvestment.notes) || '';
  }

  openEditModal(investment: any) {
    this.originalEditDate = this.toLocalYmd(investment.investment_date);
    this.currentInvestment = {
      ...investment,
      investment_date: this.originalEditDate || this.todayYmd()
    };
    this.isEditing = true;
    this.showModal = true;
    this.duplicateMatches = [];
    this.syncMaturityFromNotes();

    if (investment.investment_type) {
      this.loadTypeOptions().then(() => {
        this.currentInvestment.sub_type_name = investment.sub_type_name;
        this.currentInvestment.sub_type_category = investment.sub_type_category;
      });
    }
  }

  onInvestmentTypeChange() {
    this.currentInvestment.sub_type_name = '';
    this.currentInvestment.sub_type_category = '';
    this.showNewSubTypeInput = false;
    this.showNewCategoryInput = false;
    if (!this.showMaturityHelper) {
      this.maturityDate = '';
      this.currentInvestment.notes = setMaturityDateInNotes(this.currentInvestment.notes, null);
    }
    this.refreshDuplicateWarning();
    return this.loadTypeOptions();
  }

  loadTypeOptions(): Promise<void> {
    const selectedType = this.currentInvestment.investment_type;
    if (!selectedType) {
      this.investmentSubTypes = [];
      this.investmentCategories = [];
      return Promise.resolve();
    }

    if (INVESTMENT_SUB_TYPES[selectedType]) {
      this.investmentSubTypes = [...INVESTMENT_SUB_TYPES[selectedType].subTypes];
      this.investmentCategories = [...INVESTMENT_SUB_TYPES[selectedType].categories];
    }

    return new Promise<void>((resolve) => {
      let pending = 2;
      const done = () => {
        pending -= 1;
        if (pending <= 0) resolve();
      };

      this.categoryService.getSubTypeNamesByInvestmentType(selectedType).subscribe({
        next: (response) => {
          if (response.success) {
            this.dbSubTypeNames = [
              ...this.dbSubTypeNames.filter(stn => stn.investment_type !== selectedType),
              ...response.data
            ];
            this.updateSubTypeOptions();
          }
          done();
        },
        error: (error) => {
          console.error('Error loading sub-type names:', error);
          done();
        }
      });

      this.categoryService.getCategories(selectedType).subscribe({
        next: (response) => {
          if (response.success) {
            this.dbCategories = [
              ...this.dbCategories.filter(cat => cat.investment_type !== selectedType),
              ...response.data
            ];
            this.updateCategoryOptions();
          }
          done();
        },
        error: (error) => {
          console.error('Error loading categories:', error);
          done();
        }
      });
    });
  }

  updateSubTypeOptions() {
    const selectedType = this.currentInvestment.investment_type;
    if (selectedType) {
      const dbOptions = this.dbSubTypeNames
        .filter(stn => stn.investment_type === selectedType)
        .map(stn => stn.name);
      
      // Combine with predefined options and remove duplicates
      const predefined = INVESTMENT_SUB_TYPES[selectedType]?.subTypes || [];
      this.investmentSubTypes = [...new Set([...predefined, ...dbOptions])].sort();
    }
  }

  updateCategoryOptions() {
    const selectedType = this.currentInvestment.investment_type;
    if (selectedType) {
      const dbOptions = this.dbCategories
        .filter(cat => cat.investment_type === selectedType)
        .map(cat => cat.category);
      
      // Combine with predefined options and remove duplicates
      const predefined = INVESTMENT_SUB_TYPES[selectedType]?.categories || [];
      this.investmentCategories = [...new Set([...predefined, ...dbOptions])].sort();
    }
  }

  toggleNewSubType() {
    this.showNewSubTypeInput = !this.showNewSubTypeInput;
    if (this.showNewSubTypeInput) {
      this.currentInvestment.sub_type_name = '';
    }
  }

  toggleNewCategory() {
    this.showNewCategoryInput = !this.showNewCategoryInput;
    if (this.showNewCategoryInput) {
      this.currentInvestment.sub_type_category = '';
    }
  }

  addNewSubType() {
    if (this.newSubType.trim()) {
      const newSubTypeName: SubTypeName = {
        name: this.newSubType.trim(),
        investment_type: this.currentInvestment.investment_type
      };

      // Save to database
      this.categoryService.createSubTypeName(newSubTypeName).subscribe({
        next: (response) => {
          if (response.success) {
            // Add to local cache
            this.dbSubTypeNames.push(response.data);
            this.updateSubTypeOptions();
            
            // Select the newly added sub-type
            this.currentInvestment.sub_type_name = this.newSubType.trim();
            this.newSubType = '';
            this.showNewSubTypeInput = false;
          }
        },
        error: (error) => {
          console.error('Error saving sub-type name:', error);
          // Even if DB save fails, still add to UI
          this.updateSubTypeOptions();
          this.currentInvestment.sub_type_name = this.newSubType.trim();
          this.newSubType = '';
          this.showNewSubTypeInput = false;
        }
      });
    }
  }

  addNewCategory() {
    if (this.newCategory.trim()) {
      const newCategory: Category = {
        category: this.newCategory.trim(),
        investment_type: this.currentInvestment.investment_type,
        sub_type_name_id: null
      };

      // Save to database
      this.categoryService.createCategory(newCategory).subscribe({
        next: (response) => {
          if (response.success) {
            // Add to local cache
            this.dbCategories.push(response.data);
            this.updateCategoryOptions();
            
            // Select the newly added category
            this.currentInvestment.sub_type_category = this.newCategory.trim();
            this.newCategory = '';
            this.showNewCategoryInput = false;
          }
        },
        error: (error) => {
          console.error('Error saving category:', error);
          // Even if DB save fails, still add to UI
          this.updateCategoryOptions();
          this.currentInvestment.sub_type_category = this.newCategory.trim();
          this.newCategory = '';
          this.showNewCategoryInput = false;
        }
      });
    }
  }

  closePopup() {
    this.showModal = false;
    this.saving = false;
    this.duplicateMatches = [];
    this.originalEditDate = '';
    this.maturityDate = '';
  }

  onSubmit() {
    if (this.saving) return;
    this.refreshDuplicateWarning();
    this.saving = true;
    this.currentInvestment.notes = setMaturityDateInNotes(this.currentInvestment.notes, this.maturityDate || null);
    const payload = {
      ...this.currentInvestment,
      notes: this.currentInvestment.notes || null
    };
    if (this.isEditing && this.currentInvestment.id) {
      this.investmentService.update(this.currentInvestment.id, payload).subscribe({
        next: () => {
          this.closePopup();
          this.showFlash('Investment updated.', 'success');
          this.loadInvestments();
        },
        error: (error) => {
          console.error('Error updating investment:', error);
          this.errorMessage = 'Failed to update investment. ' + (error.message || '');
          this.saving = false;
        }
      });
    } else {
      this.investmentService.create(payload).subscribe({
        next: () => {
          this.closePopup();
          this.showFlash('Investment added.', 'success');
          this.loadInvestments();
        },
        error: (error) => {
          console.error('Error creating investment:', error);
          this.errorMessage = 'Failed to create investment. ' + (error.message || '');
          this.saving = false;
        }
      });
    }
  }

  deleteInvestment(investment: any) {
    const label = this.holdingLabel(investment);
    if (!confirm(`Delete ${label} (${this.formatInr(investment.amount)})?`)) {
      return;
    }
    this.investmentService.delete(investment.id).subscribe({
      next: () => {
        this.investments = this.investments.filter(item => item.id !== investment.id);
        this.selectedIds.delete(investment.id);
        this.selectedIds = new Set(this.selectedIds);
        this.showFlash('Investment deleted.', 'success');
        this.applyFilters();
      },
      error: (error) => {
        console.error('Error deleting investment:', error);
        this.errorMessage = 'Failed to delete investment. ' + (error.message || '');
      }
    });
  }

  viewHistory(investment: any) {
    this.historyLoading = true;
    this.currentInvestmentName = `${investment.website_app_name} - ${investment.investment_type}`;
    
    // Call the API to get the actual history
    this.analyticsService.getInvestmentHistory(investment.id).subscribe({
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
          
          this.historyData = enhancedHistory;
        } else {
          // If no history found, show a message
          this.historyData = [{
            id: 0,
            change_type: 'info',
            amount: investment.amount,
            change_date: investment.investment_date,
            notes: 'No history records found for this investment.',
            difference: 0,
            differencePercentage: 0,
            isIncrease: false,
            isDecrease: false
          }];
        }
        this.showHistoryModal = true;
        this.historyLoading = false;
      },
      error: (error) => {
        console.error('Error loading investment history:', error);
        // Show a fallback message
        this.historyData = [{
          id: 0,
          change_type: 'error',
          amount: investment.amount,
          change_date: investment.investment_date,
          notes: 'Failed to load history data. Please try again later.',
          difference: 0,
          differencePercentage: 0,
          isIncrease: false,
          isDecrease: false
        }];
        this.showHistoryModal = true;
        this.historyLoading = false;
      }
    });
  }

  closeHistoryModal() {
    this.showHistoryModal = false;
    this.historyData = [];
    this.currentInvestmentName = '';
    this.historyLoading = false;
  }

  formatDate(date: Date): string {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  // Helper method for calculating min value in template
  getMin(a: number, b: number): number {
    return Math.min(a, b);
  }

  // Helper method to get history button class based on record count
  getHistoryButtonClass(investment: any): string {
    // Use the actual history count from the investment data
    const historyCount = investment.history_count || 0;
    
    if (historyCount > 1) {
      return 'history-btn multiple-records';
    } else {
      return 'history-btn';
    }
  }

  // Helper method to get history button text
  getHistoryButtonText(investment: any): string {
    // Use the actual history count from the investment data
    const historyCount = investment.history_count || 0;
    
    return `📜 ${historyCount}`;
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.showHistoryModal) {
      this.closeHistoryModal();
    } else if (this.showModal) {
      this.closePopup();
    }
  }

  todayYmd(): string {
    return this.toLocalYmd(new Date());
  }

  toLocalYmd(date: Date | string | null | undefined): string {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  useTodayDate() {
    this.currentInvestment.investment_date = this.todayYmd();
  }

  holdingLabel(investment: any): string {
    const parts = [
      investment.website_app_name,
      investment.sub_type_name || investment.investment_type,
      investment.sub_type_category
    ].filter(Boolean);
    return parts.join(' · ');
  }

  formatInr(value: number): string {
    return `₹${formatIndianFull(Number(value) || 0)}`;
  }

  formatInrCompact(value: number): string {
    return getIndianAmountBreakdown(Number(value) || 0).primaryDisplay;
  }

  get filteredTotalAmount(): number {
    return this.filteredInvestments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }

  get portfolioTotalAmount(): number {
    return this.investments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }

  get filteredAverageAmount(): number {
    if (!this.filteredInvestments.length) return 0;
    return this.filteredTotalAmount / this.filteredInvestments.length;
  }

  get selectedInvestments(): any[] {
    return this.filteredInvestments.filter(item => this.selectedIds.has(item.id));
  }

  get selectedTotalAmount(): number {
    return this.selectedInvestments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }

  amountShare(amount: number): number {
    if (!this.filteredTotalAmount) return 0;
    return (Number(amount) || 0) / this.filteredTotalAmount * 100;
  }

  get typeSummaries(): { type: string; count: number; total: number }[] {
    const map = new Map<string, { count: number; total: number }>();
    for (const item of this.investments) {
      const type = item.investment_type || 'Other';
      const current = map.get(type) || { count: 0, total: 0 };
      current.count += 1;
      current.total += Number(item.amount) || 0;
      map.set(type, current);
    }
    return [...map.entries()]
      .map(([type, stats]) => ({ type, ...stats }))
      .sort((a, b) => b.total - a.total);
  }

  toggleTypeChip(type: string) {
    if (this.selectedTypes.includes(type)) {
      this.selectedTypes = this.selectedTypes.filter(item => item !== type);
    } else {
      this.selectedTypes = [...this.selectedTypes, type];
    }
    this.onAdvancedTypeChange();
  }

  isSelected(id: number): boolean {
    return this.selectedIds.has(id);
  }

  toggleSelect(id: number) {
    const next = new Set(this.selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selectedIds = next;
  }

  get allPageSelected(): boolean {
    return this.paginatedData.length > 0 && this.paginatedData.every(item => this.selectedIds.has(item.id));
  }

  get somePageSelected(): boolean {
    return this.paginatedData.some(item => this.selectedIds.has(item.id)) && !this.allPageSelected;
  }

  toggleSelectPage(selected: boolean) {
    const next = new Set(this.selectedIds);
    for (const item of this.paginatedData) {
      if (selected) {
        next.add(item.id);
      } else {
        next.delete(item.id);
      }
    }
    this.selectedIds = next;
  }

  selectFiltered() {
    this.selectedIds = new Set(this.filteredInvestments.map(item => item.id));
  }

  clearSelection() {
    this.selectedIds = new Set();
  }

  private pruneSelectionToFiltered() {
    if (!this.selectedIds.size) return;
    const allowed = new Set(this.filteredInvestments.map(item => item.id));
    const next = new Set<number>();
    this.selectedIds.forEach(id => {
      if (allowed.has(id)) next.add(id);
    });
    this.selectedIds = next;
  }

  async bulkDeleteSelected() {
    const count = this.selectedIds.size;
    if (!count || this.bulkWorking) return;
    if (!confirm(`Delete ${count} selected investment${count === 1 ? '' : 's'}? This cannot be undone.`)) {
      return;
    }
    this.bulkWorking = true;
    const ids = [...this.selectedIds];
    let deleted = 0;
    try {
      for (const id of ids) {
        await firstValueFrom(this.investmentService.delete(id));
        deleted += 1;
      }
      this.showFlash(`Deleted ${deleted} investment${deleted === 1 ? '' : 's'}.`, 'success');
      this.selectedIds = new Set();
      this.loadInvestments();
    } catch (error: any) {
      console.error('Error bulk deleting investments:', error);
      this.errorMessage = 'Failed to delete some investments. ' + (error?.message || '');
      this.loadInvestments();
    } finally {
      this.bulkWorking = false;
    }
  }

  emptyBulkForm() {
    return {
      website_app_name: '',
      investment_type: '',
      sub_type_name: '',
      sub_type_category: '',
      notes_append: ''
    };
  }

  toggleBulkReclassify() {
    this.showBulkReclassify = !this.showBulkReclassify;
    if (!this.showBulkReclassify) {
      this.bulkForm = this.emptyBulkForm();
      this.bulkSubTypes = [];
      this.bulkCategories = [];
    }
  }

  onBulkTypeChange() {
    this.bulkForm.sub_type_name = '';
    this.bulkForm.sub_type_category = '';
    const type = this.bulkForm.investment_type;
    if (!type) {
      this.bulkSubTypes = [];
      this.bulkCategories = [];
      return;
    }
    const predefined = INVESTMENT_SUB_TYPES[type];
    this.bulkSubTypes = [...(predefined?.subTypes || [])];
    this.bulkCategories = [...(predefined?.categories || [])];
    const dbSubs = this.dbSubTypeNames.filter(stn => stn.investment_type === type).map(stn => stn.name);
    const dbCats = this.dbCategories.filter(cat => cat.investment_type === type).map(cat => cat.category);
    this.bulkSubTypes = [...new Set([...this.bulkSubTypes, ...dbSubs])].sort();
    this.bulkCategories = [...new Set([...this.bulkCategories, ...dbCats])].sort();
  }

  get bulkHasChanges(): boolean {
    const f = this.bulkForm;
    return !!(
      f.website_app_name.trim() ||
      f.investment_type ||
      f.sub_type_name.trim() ||
      f.sub_type_category.trim() ||
      f.notes_append.trim()
    );
  }

  async applyBulkReclassify() {
    const count = this.selectedIds.size;
    if (!count || this.bulkWorkingReclassify || !this.bulkHasChanges) return;
    if (!confirm(`Update ${count} selected investment${count === 1 ? '' : 's'} with these fields? Amount and date stay the same.`)) {
      return;
    }
    this.bulkWorkingReclassify = true;
    const ids = [...this.selectedIds];
    const typeChanged = !!this.bulkForm.investment_type;
    let updated = 0;
    try {
      for (const id of ids) {
        const row = this.investments.find(item => item.id === id);
        if (!row) continue;
        const notesBase = row.notes || '';
        const notes = this.bulkForm.notes_append.trim()
          ? (notesBase ? `${notesBase}\n${this.bulkForm.notes_append.trim()}` : this.bulkForm.notes_append.trim())
          : notesBase;
        const payload = {
          website_app_name: this.bulkForm.website_app_name.trim() || row.website_app_name,
          investment_type: this.bulkForm.investment_type || row.investment_type,
          sub_type_name: typeChanged
            ? (this.bulkForm.sub_type_name.trim() || null)
            : (this.bulkForm.sub_type_name.trim() || row.sub_type_name || null),
          sub_type_category: typeChanged
            ? (this.bulkForm.sub_type_category.trim() || null)
            : (this.bulkForm.sub_type_category.trim() || row.sub_type_category || null),
          amount: row.amount,
          investment_date: this.toLocalYmd(row.investment_date),
          notes: notes || null
        };
        await firstValueFrom(this.investmentService.update(id, payload));
        updated += 1;
      }
      this.showFlash(`Updated ${updated} investment${updated === 1 ? '' : 's'}.`, 'success');
      this.bulkForm = this.emptyBulkForm();
      this.showBulkReclassify = false;
      this.selectedIds = new Set();
      this.loadInvestments();
    } catch (error: any) {
      console.error('Error bulk updating investments:', error);
      this.errorMessage = 'Failed to update some investments. ' + (error?.message || '');
      this.loadInvestments();
    } finally {
      this.bulkWorkingReclassify = false;
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const typing = !!target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );
    if (event.key === '/' && !typing) {
      event.preventDefault();
      this.searchInput?.nativeElement.focus();
      return;
    }
    if (typing || this.showModal || this.showHistoryModal) return;
    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      this.openAddModal();
      return;
    }
    if (event.key === 'e' || event.key === 'E') {
      const first = this.selectedInvestments[0];
      if (first) {
        event.preventDefault();
        this.openEditModal(first);
      }
    }
  }

  openCloneModal(investment: any) {
    this.currentInvestment = {
      id: null,
      website_app_name: investment.website_app_name,
      investment_type: investment.investment_type,
      sub_type_name: investment.sub_type_name || '',
      sub_type_category: investment.sub_type_category || '',
      amount: investment.amount,
      investment_date: this.todayYmd(),
      notes: investment.notes || ''
    };
    this.isEditing = false;
    this.showModal = true;
    this.originalEditDate = '';
    this.showNewSubTypeInput = false;
    this.showNewCategoryInput = false;
    this.newSubType = '';
    this.newCategory = '';
    this.syncMaturityFromNotes();
    if (investment.investment_type) {
      this.loadTypeOptions().then(() => {
        this.currentInvestment.sub_type_name = investment.sub_type_name || '';
        this.currentInvestment.sub_type_category = investment.sub_type_category || '';
        this.refreshDuplicateWarning();
      });
    }
  }

  refreshDuplicateWarning() {
    const platform = (this.currentInvestment.website_app_name || '').trim().toLowerCase();
    const type = this.currentInvestment.investment_type;
    const subType = (this.currentInvestment.sub_type_name || '').trim().toLowerCase();
    const category = (this.currentInvestment.sub_type_category || '').trim().toLowerCase();
    if (!platform || !type) {
      this.duplicateMatches = [];
      return;
    }
    this.duplicateMatches = this.investments.filter(item => {
      if (this.isEditing && item.id === this.currentInvestment.id) return false;
      return (item.website_app_name || '').trim().toLowerCase() === platform
        && item.investment_type === type
        && (item.sub_type_name || '').trim().toLowerCase() === subType
        && (item.sub_type_category || '').trim().toLowerCase() === category;
    });
  }

  exportFilteredCsv() {
    if (!this.filteredInvestments.length) return;
    const headers = [
      'Platform',
      'Type',
      'Sub Type',
      'Category',
      'Amount',
      'Percent of Filtered',
      'Investment Date',
      'Notes'
    ];
    const lines = this.filteredInvestments.map(item => [
      this.csvEscape(item.website_app_name || ''),
      this.csvEscape(item.investment_type || ''),
      this.csvEscape(item.sub_type_name || ''),
      this.csvEscape(item.sub_type_category || ''),
      Number(item.amount || 0).toFixed(2),
      this.amountShare(item.amount).toFixed(2),
      this.toLocalYmd(item.investment_date),
      this.csvEscape(item.notes || '')
    ].join(','));
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `investments-${this.todayYmd()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private computeVisiblePages(): number[] {
    const pages: number[] = [];
    if (this.totalPages < 1) return pages;
    const windowSize = 2;
    const start = Math.max(1, this.currentPage - windowSize);
    const end = Math.min(this.totalPages, this.currentPage + windowSize);
    for (let page = start; page <= end; page++) {
      pages.push(page);
    }
    return pages;
  }

  trackById(_index: number, item: any): number {
    return item.id;
  }

  showFlash(message: string, type: 'success' | 'error' | 'info') {
    this.flashMessage = message;
    this.flashType = type;
    setTimeout(() => {
      if (this.flashMessage === message) {
        this.flashMessage = '';
      }
    }, 4000);
  }
}