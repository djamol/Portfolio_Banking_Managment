import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { AppChartsModule } from '../../shared/charts.module';
import { HierarchicalCategoryPickerComponent } from '../hierarchical-category-picker/hierarchical-category-picker.component';
import { BANKING_ROUTES } from './banking.routes';
import { BankingShellComponent } from './banking-shell.component';
import { BankingOverviewComponent } from './overview/banking-overview.component';
import { BankingAccountsComponent } from './accounts/banking-accounts.component';
import { BankingImportComponent } from './import/banking-import.component';
import { BankingTransactionsComponent } from './transactions/banking-transactions.component';
import { BankingRulesComponent } from './rules/banking-rules.component';
import { BankingBudgetsComponent } from './budgets/banking-budgets.component';
import { BankingAnalyticsComponent } from './analytics/banking-analytics.component';
import { BankingChartsComponent } from './charts/banking-charts.component';
import { BankingCashflowComponent } from './cashflow/banking-cashflow.component';
import { BankingIncomeComponent } from './income/banking-income.component';
import { BankingExpenseComponent } from './expense/banking-expense.component';
import { BankingInterestComponent } from './interest/banking-interest.component';
import { BankingInsightsComponent } from './insights/banking-insights.component';

@NgModule({
  declarations: [
    HierarchicalCategoryPickerComponent,
    BankingShellComponent,
    BankingOverviewComponent,
    BankingAccountsComponent,
    BankingImportComponent,
    BankingTransactionsComponent,
    BankingRulesComponent,
    BankingBudgetsComponent,
    BankingAnalyticsComponent,
    BankingChartsComponent,
    BankingCashflowComponent,
    BankingIncomeComponent,
    BankingExpenseComponent,
    BankingInterestComponent,
    BankingInsightsComponent
  ],
  imports: [SharedModule, AppChartsModule, RouterModule.forChild(BANKING_ROUTES)]
})
export class BankingModule {}
