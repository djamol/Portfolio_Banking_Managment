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
import { BankingComponent } from './components/banking/banking.component';
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
  { path: 'banking', component: BankingComponent, canActivate: [authGuard] },
  { path: 'investment-summary', component: InvestmentSummaryComponent, canActivate: [authGuard] },
  { path: 'import-data', component: ImportDataComponent, canActivate: [authGuard] },
  { path: 'import-export', component: ImportExportComponent, canActivate: [authGuard] }
];