import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { InvestmentService } from '../../services/investment.service';
import { CategoryService, SubTypeName, Category } from '../../services/category.service';
import { INVESTMENT_TYPES, INVESTMENT_SUB_TYPES } from '../../constants/investment-types.constants';

@Component({
  selector: 'app-investment-form',
  templateUrl: './investment-form.component.html',
  styleUrls: ['./investment-form.component.css'],
  standalone: false
})
export class InvestmentFormComponent implements OnInit {
  investment = {
    website_app_name: '',
    investment_type: '',
    sub_type_name: '',
    sub_type_category: '',
    amount: 0,
    investment_date: new Date().toISOString().split('T')[0]
  };
  
  isEditing = false;
  id: number | null = null;
  loading = false;
  errorMessage = '';
  
  // Use imported constants
  investmentTypes = INVESTMENT_TYPES;
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

  constructor(
    private investmentService: InvestmentService,
    private categoryService: CategoryService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadDatabaseOptions();
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.isEditing = true;
        this.id = +id;
        this.loadInvestment(+id);
      }
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

  loadInvestment(id: number) {
    this.loading = true;
    this.investmentService.getById(id).subscribe({
      next: (response) => {
        if (response) {
          this.investment = {
            ...response,
            investment_date: new Date(response.investment_date).toISOString().split('T')[0]
          };
          // Load sub-types and categories for the selected investment type
          if (response.investment_type) {
            this.onInvestmentTypeChange();
          }
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading investment:', error);
        this.errorMessage = 'Failed to load investment data.';
        this.loading = false;
      }
    });
  }

  onInvestmentTypeChange() {
    const selectedType = this.investment.investment_type;
    if (selectedType) {
      // Load sub-type names for this investment type from DB
      this.categoryService.getSubTypeNamesByInvestmentType(selectedType).subscribe({
        next: (response) => {
          if (response.success) {
            this.dbSubTypeNames = [
              ...this.dbSubTypeNames.filter(stn => stn.investment_type !== selectedType),
              ...response.data
            ];
            this.updateSubTypeOptions();
          }
        },
        error: (error) => {
          console.error('Error loading sub-type names:', error);
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
    } else {
      this.investmentSubTypes = [];
      this.investmentCategories = [];
    }
    
    // Reset sub-type and category when investment type changes
    this.investment.sub_type_name = '';
    this.investment.sub_type_category = '';
    this.showNewSubTypeInput = false;
    this.showNewCategoryInput = false;
  }

  updateSubTypeOptions() {
    const selectedType = this.investment.investment_type;
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
    const selectedType = this.investment.investment_type;
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
      this.investment.sub_type_name = '';
    }
  }

  toggleNewCategory() {
    this.showNewCategoryInput = !this.showNewCategoryInput;
    if (this.showNewCategoryInput) {
      this.investment.sub_type_category = '';
    }
  }

  addNewSubType() {
    if (this.newSubType.trim()) {
      const newSubTypeName: SubTypeName = {
        name: this.newSubType.trim(),
        investment_type: this.investment.investment_type
      };

      // Save to database
      this.categoryService.createSubTypeName(newSubTypeName).subscribe({
        next: (response) => {
          if (response.success) {
            // Add to local cache
            this.dbSubTypeNames.push(response.data);
            this.updateSubTypeOptions();
            
            // Select the newly added sub-type
            this.investment.sub_type_name = this.newSubType.trim();
            this.newSubType = '';
            this.showNewSubTypeInput = false;
          }
        },
        error: (error) => {
          console.error('Error saving sub-type name:', error);
          // Even if DB save fails, still add to UI
          this.updateSubTypeOptions();
          this.investment.sub_type_name = this.newSubType.trim();
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
        investment_type: this.investment.investment_type,
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
            this.investment.sub_type_category = this.newCategory.trim();
            this.newCategory = '';
            this.showNewCategoryInput = false;
          }
        },
        error: (error) => {
          console.error('Error saving category:', error);
          // Even if DB save fails, still add to UI
          this.updateCategoryOptions();
          this.investment.sub_type_category = this.newCategory.trim();
          this.newCategory = '';
          this.showNewCategoryInput = false;
        }
      });
    }
  }

  onSubmit() {
    this.loading = true;
    this.errorMessage = '';

    if (this.isEditing && this.id) {
      this.investmentService.update(this.id, this.investment).subscribe({
        next: () => {
          this.router.navigate(['/investments']);
        },
        error: (error) => {
          console.error('Error updating investment:', error);
          this.errorMessage = 'Failed to update investment. ' + (error.message || '');
          this.loading = false;
        }
      });
    } else {
      this.investmentService.create(this.investment).subscribe({
        next: () => {
          this.router.navigate(['/investments']);
        },
        error: (error) => {
          console.error('Error creating investment:', error);
          this.errorMessage = 'Failed to create investment. ' + (error.message || '');
          this.loading = false;
        }
      });
    }
  }

  onCancel() {
    this.router.navigate(['/investments']);
  }
}