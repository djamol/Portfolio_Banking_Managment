import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { AppChartsModule } from '../../shared/charts.module';
import { InvestmentSummaryComponent } from './investment-summary.component';

@NgModule({
  declarations: [InvestmentSummaryComponent],
  imports: [
    SharedModule,
    AppChartsModule,
    RouterModule.forChild([{ path: '', component: InvestmentSummaryComponent }])
  ]
})
export class InvestmentSummaryModule {}
