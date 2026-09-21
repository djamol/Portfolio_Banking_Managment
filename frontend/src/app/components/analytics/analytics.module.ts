import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { AppChartsModule } from '../../shared/charts.module';
import { AnalyticsComponent } from './analytics.component';

@NgModule({
  declarations: [AnalyticsComponent],
  imports: [
    SharedModule,
    AppChartsModule,
    RouterModule.forChild([{ path: '', component: AnalyticsComponent }])
  ]
})
export class AnalyticsModule {}
