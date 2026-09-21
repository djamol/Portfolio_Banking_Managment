import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () =>
      import('./components/login/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'dashboard',
    loadChildren: () =>
      import('./components/dashboard/dashboard.module').then((m) => m.DashboardModule),
    canActivate: [authGuard]
  },
  {
    path: 'investments',
    loadChildren: () =>
      import('./components/investment-list/investments.module').then((m) => m.InvestmentsModule),
    canActivate: [authGuard]
  },
  {
    path: 'mutual-fund-history',
    loadChildren: () =>
      import('./components/mutual-fund-history/mutual-fund-history.module').then(
        (m) => m.MutualFundHistoryModule
      ),
    canActivate: [authGuard]
  },
  {
    path: 'cashflows',
    loadChildren: () =>
      import('./components/cashflows/cashflows.module').then((m) => m.CashflowsModule),
    canActivate: [authGuard]
  },
  {
    path: 'analytics',
    loadChildren: () =>
      import('./components/analytics/analytics.module').then((m) => m.AnalyticsModule),
    canActivate: [authGuard]
  },
  {
    path: 'asset-tracker',
    loadChildren: () =>
      import('./components/asset-tracker/asset-tracker.module').then((m) => m.AssetTrackerModule),
    canActivate: [authGuard]
  },
  {
    path: 'banking',
    loadChildren: () =>
      import('./components/banking/banking.module').then((m) => m.BankingModule),
    canActivate: [authGuard]
  },
  {
    path: 'investment-summary',
    loadChildren: () =>
      import('./components/investment-summary/investment-summary.module').then(
        (m) => m.InvestmentSummaryModule
      ),
    canActivate: [authGuard]
  },
  {
    path: 'import-data',
    loadChildren: () =>
      import('./components/import-data/import-data.module').then((m) => m.ImportDataModule),
    canActivate: [authGuard]
  },
  {
    path: 'import-export',
    loadComponent: () =>
      import('./components/import-export/import-export.component').then(
        (m) => m.ImportExportComponent
      ),
    canActivate: [authGuard]
  }
];
