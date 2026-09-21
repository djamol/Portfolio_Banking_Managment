import { NgModule } from '@angular/core';
import { NgChartsModule } from 'ng2-charts';
import { registerAppCharts } from './chart-setup';

registerAppCharts();

@NgModule({
  imports: [NgChartsModule],
  exports: [NgChartsModule]
})
export class AppChartsModule {}
