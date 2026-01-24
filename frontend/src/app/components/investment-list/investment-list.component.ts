import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { InvestmentService } from '../../services/investment.service';
import { AnalyticsService } from '../../services/analytics.service';
import { CategoryService, SubTypeName, Category } from '../../services/category.service';
import { INVESTMENT_TYPES, INVESTMENT_SUB_TYPES } from '../../constants/investment-types.constants';

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

  // Search and filter properties
  searchTerm: string = '';
  selectedType: string = '';
  selectedPlatform: string = '';
  sortBy: string = 'investment_date';
  sortDirection: 'asc' | 'desc' = 'desc';

  // Pagination properties
  currentPage: number = 1;
  itemsPerPage: number = 10;
  totalPages: number = 0;
  paginatedData: any[] = [];

  // Unique values for filters
  investmentTypes: string[] = INVESTMENT_TYPES;
  platforms: string[] = [];

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
    private analyticsService: AnalyticsService
  ) {}

  ngOnInit() {
    this.loadInvestments();
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
    // Use predefined investment types instead of extracting from data
    // this.investmentTypes is already set to INVESTMENT_TYPES
      
    // Extract unique platforms
    this.platforms = [...new Set(this.investments.map(item => item.website_app_name))].filter(Boolean);
  }

  applyFilters() {
    // Apply search term filter
    let result = this.investments.filter(item => {
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
    this.calculatePagination();
    this.updatePaginatedData();
  }

  calculatePagination() {
    this.totalPages = Math.ceil(this.filteredInvestments.length / this.itemsPerPage);
    if (this.currentPage > this.totalPages && this.totalPages > 0) {
      this.currentPage = this.totalPages;
    }
  }

  updatePaginatedData() {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    this.paginatedData = this.filteredInvestments.slice(startIndex, endIndex);
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
      investment_date: new Date().toISOString().split('T')[0],
      notes: ''
    };
    this.isEditing = false;
    this.showModal = true;
    
    // Reset dynamic options
    this.investmentSubTypes = [];
    this.investmentCategories = [];
    this.showNewSubTypeInput = false;
    this.showNewCategoryInput = false;
    this.newSubType = '';
    this.newCategory = '';
  }

  openEditModal(investment: any) {
    this.currentInvestment = {
      ...investment,
      investment_date: new Date(investment.investment_date).toISOString().split('T')[0]
    };
    this.isEditing = true;
    this.showModal = true;
    
    // Load sub-types and categories for the selected investment type
    if (investment.investment_type) {
      this.onInvestmentTypeChange().then(() => {
        // After options are loaded, set the selected values
        this.currentInvestment.sub_type_name = investment.sub_type_name;
        this.currentInvestment.sub_type_category = investment.sub_type_category;
      });
    }
  }

  onInvestmentTypeChange() {
    const selectedType = this.currentInvestment.investment_type;
    if (selectedType) {
      // Load sub-type names for this investment type from DB
      return new Promise<void>((resolve) => {
        this.categoryService.getSubTypeNamesByInvestmentType(selectedType).subscribe({
          next: (response) => {
            if (response.success) {
              this.dbSubTypeNames = [
                ...this.dbSubTypeNames.filter(stn => stn.investment_type !== selectedType),
                ...response.data
              ];
              this.updateSubTypeOptions();
            }
            resolve();
          },
          error: (error) => {
            console.error('Error loading sub-type names:', error);
            resolve();
          }
        });

        // Load categories for this investment type from DB
        this.categoryService.getCategories(selectedType).subscribe({
          next: (response) => {
            if (response.success) {
              this.dbCategories = [
                ...this.dbCategories.filter(cat => cat.investment_type !== selectedType),
                ...response.data
              ];
              this.updateCategoryOptions();
            }
          },
          error: (error) => {
            console.error('Error loading categories:', error);
          }
        });

        // Also include predefined options
        if (INVESTMENT_SUB_TYPES[selectedType]) {
          this.investmentSubTypes = [...INVESTMENT_SUB_TYPES[selectedType].subTypes];
          this.investmentCategories = [...INVESTMENT_SUB_TYPES[selectedType].categories];
        }
      });
    } else {
      this.investmentSubTypes = [];
      this.investmentCategories = [];
      return Promise.resolve();
    }
    
    // Reset sub-type and category when investment type changes
    this.currentInvestment.sub_type_name = '';
    this.currentInvestment.sub_type_category = '';
    this.showNewSubTypeInput = false;
    this.showNewCategoryInput = false;
    
    return Promise.resolve();
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
  }

  onSubmit() {
    if (this.isEditing && this.currentInvestment.id) {
      this.investmentService.update(this.currentInvestment.id, this.currentInvestment).subscribe({
        next: () => {
          this.closePopup();
          // Reload investments to get updated data including history count
          this.loadInvestments();
        },
        error: (error) => {
          console.error('Error updating investment:', error);
          this.errorMessage = 'Failed to update investment. ' + (error.message || '');
        }
      });
    } else {
      this.investmentService.create(this.currentInvestment).subscribe({
        next: () => {
          this.closePopup();
          // Reload investments to get updated data including history count
          this.loadInvestments();
        },
        error: (error) => {
          console.error('Error creating investment:', error);
          this.errorMessage = 'Failed to create investment. ' + (error.message || '');
        }
      });
    }
  }

  deleteInvestment(id: number) {
    if (confirm('Are you sure you want to delete this investment?')) {
      this.investmentService.delete(id).subscribe({
        next: () => {
          this.investments = this.investments.filter(item => item.id !== id);
          this.applyFilters(); // Reapply filters to update the display
        },
        error: (error) => {
          console.error('Error deleting investment:', error);
          this.errorMessage = 'Failed to delete investment. ' + (error.message || '');
        }
      });
    }
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
}