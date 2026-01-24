import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { NgChartsModule } from 'ng2-charts';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AppComponent } from './app.component';
import { AnalyticsComponent } from './components/analytics/analytics.component';
import { InvestmentListComponent } from './components/investment-list/investment-list.component';
import { InvestmentSummaryComponent } from './components/investment-summary/investment-summary.component';
import { InvestmentFormComponent } from './components/investment-form/investment-form.component';
import { routes } from './app.routes';

@NgModule({
  declarations: [
    AppComponent,
    AnalyticsComponent,
    InvestmentListComponent,
    InvestmentSummaryComponent,
    InvestmentFormComponent
  ],
  imports: [
    BrowserModule,
    CommonModule,
    FormsModule,
    HttpClientModule,
    RouterModule.forRoot(routes),
    NgChartsModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }