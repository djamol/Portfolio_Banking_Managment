import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { AppChartsModule } from '../../shared/charts.module';
import { MutualFundHistoryComponent } from './mutual-fund-history.component';

@NgModule({
  declarations: [MutualFundHistoryComponent],
  imports: [
    SharedModule,
    AppChartsModule,
    RouterModule.forChild([{ path: '', component: MutualFundHistoryComponent }])
  ]
})
export class MutualFundHistoryModule {}
