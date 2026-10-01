import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { AppChartsModule } from '../../shared/charts.module';
import { FundAnalyticsComponent } from './fund-analytics.component';

@NgModule({
  declarations: [FundAnalyticsComponent],
  imports: [
    SharedModule,
    AppChartsModule,
    RouterModule.forChild([{ path: '', component: FundAnalyticsComponent }])
  ]
})
export class FundAnalyticsModule {}
