import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HTTP_INTERCEPTORS, HttpClientModule } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { NgChartsModule } from 'ng2-charts';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AppComponent } from './app.component';
import { AnalyticsComponent } from './components/analytics/analytics.component';
import { InvestmentListComponent } from './components/investment-list/investment-list.component';
import { InvestmentSummaryComponent } from './components/investment-summary/investment-summary.component';
import { InvestmentFormComponent } from './components/investment-form/investment-form.component';
import { ImportDataComponent } from './components/import-data/import-data.component';
import { MultiSelectFilterComponent } from './components/multi-select-filter/multi-select-filter.component';
import { HierarchicalCategoryPickerComponent } from './components/hierarchical-category-picker/hierarchical-category-picker.component';
import { AssetTrackerComponent } from './components/asset-tracker/asset-tracker.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { BankingShellComponent } from './components/banking/banking-shell.component';
import { BankingOverviewComponent } from './components/banking/overview/banking-overview.component';
import { BankingAccountsComponent } from './components/banking/accounts/banking-accounts.component';
import { BankingImportComponent } from './components/banking/import/banking-import.component';
import { BankingTransactionsComponent } from './components/banking/transactions/banking-transactions.component';
import { BankingRulesComponent } from './components/banking/rules/banking-rules.component';
import { BankingAnalyticsComponent } from './components/banking/analytics/banking-analytics.component';
import { BankingChartsComponent } from './components/banking/charts/banking-charts.component';
import { BankingCashflowComponent } from './components/banking/cashflow/banking-cashflow.component';
import { BankingIncomeComponent } from './components/banking/income/banking-income.component';
import { BankingInterestComponent } from './components/banking/interest/banking-interest.component';
import { BankingInsightsComponent } from './components/banking/insights/banking-insights.component';
import { BankingBudgetsComponent } from './components/banking/budgets/banking-budgets.component';
import { CashflowsComponent } from './components/cashflows/cashflows.component';
import { AuthInterceptor } from './services/auth.interceptor';
import { routes } from './app.routes';

@NgModule({
  declarations: [
    AppComponent,
    AnalyticsComponent,
    InvestmentListComponent,
    InvestmentSummaryComponent,
    InvestmentFormComponent,
    ImportDataComponent,
    MultiSelectFilterComponent,
    HierarchicalCategoryPickerComponent,
    AssetTrackerComponent,
    DashboardComponent,
    BankingShellComponent,
    BankingOverviewComponent,
    BankingAccountsComponent,
    BankingImportComponent,
    BankingTransactionsComponent,
    BankingRulesComponent,
    BankingAnalyticsComponent,
    BankingChartsComponent,
    BankingCashflowComponent,
    BankingIncomeComponent,
    BankingInterestComponent,
    BankingInsightsComponent,
    BankingBudgetsComponent,
    CashflowsComponent
  ],
  imports: [
    BrowserModule,
    CommonModule,
    FormsModule,
    HttpClientModule,
    RouterModule.forRoot(routes, { useHash: true }),
    NgChartsModule
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
