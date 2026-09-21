import { Routes } from '@angular/router';
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

export const BANKING_ROUTES: Routes = [
  {
    path: '',
    component: BankingShellComponent,
    children: [
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
      { path: 'overview', component: BankingOverviewComponent },
      { path: 'accounts', component: BankingAccountsComponent },
      { path: 'import', component: BankingImportComponent },
      { path: 'transactions', component: BankingTransactionsComponent },
      { path: 'rules', component: BankingRulesComponent },
      { path: 'budgets', component: BankingBudgetsComponent },
      { path: 'analytics', component: BankingAnalyticsComponent },
      { path: 'charts', component: BankingChartsComponent },
      { path: 'cashflow', component: BankingCashflowComponent },
      { path: 'income', component: BankingIncomeComponent },
      { path: 'expense', component: BankingExpenseComponent },
      { path: 'interest', component: BankingInterestComponent },
      { path: 'insights', component: BankingInsightsComponent }
    ]
  }
];
