import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { InvestmentService } from '../../services/investment.service';
import { MutualFundScheme, MutualFundService } from '../../services/mutual-fund.service';
import { CategoryService, SubTypeName, Category } from '../../services/category.service';
import { INVESTMENT_TYPES, INVESTMENT_SUB_TYPES } from '../../constants/investment-types.constants';
import {
  parseMaturityDateFromNotes,
  setMaturityDateInNotes,
  showsMaturityHelper
} from '../../utils/maturity-notes.util';

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
    units: null as number | null,
    nav_price: null as number | null,
    nav_source: null as string | null,
    avg_buy_price: null as number | null,
    invested_amount: null as number | null,
    profit_loss: null as number | null,
    mutual_fund_scheme_code: '',
    investment_date: new Date().toISOString().split('T')[0],
    notes: ''
  };

  isEditing = false;
  id: number | null = null;
  loading = false;
  errorMessage = '';
  maturityDate = '';
  originalEditDate = '';
  platforms: string[] = [];
  existingInvestments: any[] = [];
  duplicateMatches: any[] = [];
  mutualFundSearch = '';
  mutualFundResults: MutualFundScheme[] = [];
  mutualFundSearchLoading = false;

  investmentTypes = INVESTMENT_TYPES;
  investmentSubTypes: string[] = [];
  investmentCategories: string[] = [];

  dbSubTypeNames: SubTypeName[] = [];
  dbCategories: Category[] = [];

  showNewSubTypeInput = false;
  showNewCategoryInput = false;
  newSubType = '';
  newCategory = '';

  constructor(
    private investmentService: InvestmentService,
    private mutualFundService: MutualFundService,
    private categoryService: CategoryService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadDatabaseOptions();
    this.loadPlatformOptions();
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.isEditing = true;
        this.id = +id;
        this.loadInvestment(+id);
      }
    });
  }

  get showMaturityHelper(): boolean {
    return showsMaturityHelper(this.investment.investment_type);
  }

  loadDatabaseOptions() {
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

  loadPlatformOptions() {
    this.investmentService.getAll().subscribe({
      next: (rows) => {
        this.existingInvestments = rows || [];
        this.platforms = [...new Set(this.existingInvestments.map(item => item.website_app_name))]
          .filter(Boolean)
          .sort();
        this.refreshDuplicateWarning();
      },
      error: (error) => {
        console.error('Error loading platforms:', error);
      }
    });
  }

  loadInvestment(id: number) {
    this.loading = true;
    this.investmentService.getById(id).subscribe({
      next: (response) => {
        if (response) {
          this.originalEditDate = this.toLocalYmd(response.investment_date);
          this.investment = {
            website_app_name: response.website_app_name || '',
            investment_type: response.investment_type || '',
            sub_type_name: response.sub_type_name || '',
            sub_type_category: response.sub_type_category || '',
            amount: Number(response.amount) || 0,
            units: response.units != null ? Number(response.units) : null,
            nav_price: response.nav_price != null ? Number(response.nav_price) : null,
            nav_source: response.nav_source || null,
            avg_buy_price: response.avg_buy_price != null ? Number(response.avg_buy_price) : null,
            invested_amount: response.invested_amount != null ? Number(response.invested_amount) : null,
            profit_loss: response.profit_loss != null ? Number(response.profit_loss) : null,
            mutual_fund_scheme_code: response.mutual_fund_scheme_code || '',
            investment_date: this.todayYmd(),
            notes: response.notes || ''
          };
          if (response.investment_type === 'Mutual Fund') {
            this.mutualFundSearch = response.sub_type_name || '';
          }
          this.maturityDate = parseMaturityDateFromNotes(this.investment.notes) || '';
          if (response.investment_type) {
            this.loadTypeOptions().then(() => {
              this.investment.sub_type_name = response.sub_type_name || '';
              this.investment.sub_type_category = response.sub_type_category || '';
              this.refreshDuplicateWarning();
            });
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
    this.investment.sub_type_name = '';
    this.investment.sub_type_category = '';
    this.showNewSubTypeInput = false;
    this.showNewCategoryInput = false;
    if (this.investment.investment_type !== 'Mutual Fund') {
      this.mutualFundSearch = '';
      this.mutualFundResults = [];
      this.investment.mutual_fund_scheme_code = '';
    }
    if (!this.showMaturityHelper) {
      this.maturityDate = '';
      this.investment.notes = setMaturityDateInNotes(this.investment.notes, null);
    }
    this.loadTypeOptions();
    this.refreshDuplicateWarning();
  }

  searchMutualFunds() {
    const query = this.mutualFundSearch.trim();
    if (query.length < 2) {
      this.mutualFundResults = [];
      return;
    }
    this.mutualFundSearchLoading = true;
    this.mutualFundService.search(query).subscribe({
      next: results => {
        this.mutualFundResults = results.slice(0, 20);
        this.mutualFundSearchLoading = false;
      },
      error: () => {
        this.mutualFundResults = [];
        this.mutualFundSearchLoading = false;
      }
    });
  }

  selectMutualFund(scheme: MutualFundScheme) {
    this.mutualFundSearch = scheme.schemeName;
    this.investment.sub_type_name = scheme.schemeName;
    this.investment.mutual_fund_scheme_code = String(scheme.schemeCode);
    this.mutualFundResults = [];
    this.refreshDuplicateWarning();
  }

  loadTypeOptions(): Promise<void> {
    const selectedType = this.investment.investment_type;
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
    const selectedType = this.investment.investment_type;
    if (selectedType) {
      const dbOptions = this.dbSubTypeNames
        .filter(stn => stn.investment_type === selectedType)
        .map(stn => stn.name);
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
      const predefined = INVESTMENT_SUB_TYPES[selectedType]?.categories || [];
      this.investmentCategories = [...new Set([...predefined, ...dbOptions])].sort();
    }
  }

  onMaturityDateChange() {
    this.investment.notes = setMaturityDateInNotes(this.investment.notes, this.maturityDate || null);
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

      this.categoryService.createSubTypeName(newSubTypeName).subscribe({
        next: (response) => {
          if (response.success) {
            this.dbSubTypeNames.push(response.data);
            this.updateSubTypeOptions();
            this.investment.sub_type_name = this.newSubType.trim();
            this.newSubType = '';
            this.showNewSubTypeInput = false;
          }
        },
        error: (error) => {
          console.error('Error saving sub-type name:', error);
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

      this.categoryService.createCategory(newCategory).subscribe({
        next: (response) => {
          if (response.success) {
            this.dbCategories.push(response.data);
            this.updateCategoryOptions();
            this.investment.sub_type_category = this.newCategory.trim();
            this.newCategory = '';
            this.showNewCategoryInput = false;
          }
        },
        error: (error) => {
          console.error('Error saving category:', error);
          this.updateCategoryOptions();
          this.investment.sub_type_category = this.newCategory.trim();
          this.newCategory = '';
          this.showNewCategoryInput = false;
        }
      });
    }
  }

  refreshDuplicateWarning() {
    const platform = (this.investment.website_app_name || '').trim().toLowerCase();
    const type = this.investment.investment_type;
    const subType = (this.investment.sub_type_name || '').trim().toLowerCase();
    const category = (this.investment.sub_type_category || '').trim().toLowerCase();
    if (!platform || !type) {
      this.duplicateMatches = [];
      return;
    }
    this.duplicateMatches = this.existingInvestments.filter(item => {
      if (this.isEditing && item.id === this.id) return false;
      return (item.website_app_name || '').trim().toLowerCase() === platform
        && item.investment_type === type
        && (item.sub_type_name || '').trim().toLowerCase() === subType
        && (item.sub_type_category || '').trim().toLowerCase() === category;
    });
  }

  onSubmit() {
    this.loading = true;
    this.errorMessage = '';
    this.investment.notes = setMaturityDateInNotes(this.investment.notes, this.maturityDate || null);
    const payload = {
      ...this.investment,
      notes: this.investment.notes || null
    };

    if (this.isEditing && this.id) {
      this.investmentService.update(this.id, payload).subscribe({
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
      this.investmentService.create(payload).subscribe({
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
}
