import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { AppChartsModule } from '../../shared/charts.module';
import { FdAnalyticsComponent } from './fd-analytics.component';

@NgModule({
  declarations: [FdAnalyticsComponent],
  imports: [
    SharedModule,
    AppChartsModule,
    RouterModule.forChild([{ path: '', component: FdAnalyticsComponent }])
  ]
})
export class FdAnalyticsModule {}
