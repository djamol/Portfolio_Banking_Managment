import { Routes } from '@angular/router';
import { InvestmentListComponent } from './components/investment-list/investment-list.component';
import { AnalyticsComponent } from './components/analytics/analytics.component';
import { InvestmentSummaryComponent } from './components/investment-summary/investment-summary.component';
import { InvestmentFormComponent } from './components/investment-form/investment-form.component';
import { ImportDataComponent } from './components/import-data/import-data.component';
import { ImportExportComponent } from './components/import-export/import-export.component';
import { LoginComponent } from './components/login/login.component';
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
import { BankingInterestComponent } from './components/banking/interest/banking-interest.component';
import { BankingInsightsComponent } from './components/banking/insights/banking-insights.component';
import { BankingBudgetsComponent } from './components/banking/budgets/banking-budgets.component';
import { CashflowsComponent } from './components/cashflows/cashflows.component';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'investments', component: InvestmentListComponent, canActivate: [authGuard] },
  { path: 'investments/new', component: InvestmentFormComponent, canActivate: [authGuard] },
  { path: 'investments/edit/:id', component: InvestmentFormComponent, canActivate: [authGuard] },
  { path: 'cashflows', component: CashflowsComponent, canActivate: [authGuard] },
  { path: 'analytics', component: AnalyticsComponent, canActivate: [authGuard] },
  { path: 'asset-tracker', component: AssetTrackerComponent, canActivate: [authGuard] },
  {
    path: 'banking',
    component: BankingShellComponent,
    canActivate: [authGuard],
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
      { path: 'interest', component: BankingInterestComponent },
      { path: 'insights', component: BankingInsightsComponent }
    ]
  },
  { path: 'investment-summary', component: InvestmentSummaryComponent, canActivate: [authGuard] },
  { path: 'import-data', component: ImportDataComponent, canActivate: [authGuard] },
  { path: 'import-export', component: ImportExportComponent, canActivate: [authGuard] }
];
