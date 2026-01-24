import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { InvestmentService } from '../../services/investment.service';

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
  investmentTypes = ['FD', 'Stock', 'ETF', 'Bond', 'Mutual Fund', 'Crypto', 'PPF', 'Saving Bank Balance'];

  constructor(
    private investmentService: InvestmentService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.isEditing = true;
        this.id = +id;
        this.loadInvestment(+id);
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

  onSubmit() {
    this.loading = true;
    this.errorMessage = '';

    if (this.isEditing && this.id) {
      this.investmentService.update(this.id, this.investment).subscribe({
        next: () => {
          this.router.navigate(['/investments']);
        },
        error: (error) => {
          console.error('dddError updating investment:', error);
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