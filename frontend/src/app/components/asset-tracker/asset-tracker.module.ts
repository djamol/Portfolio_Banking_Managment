import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { AppChartsModule } from '../../shared/charts.module';
import { AssetTrackerComponent } from './asset-tracker.component';

@NgModule({
  declarations: [AssetTrackerComponent],
  imports: [
    SharedModule,
    AppChartsModule,
    RouterModule.forChild([{ path: '', component: AssetTrackerComponent }])
  ]
})
export class AssetTrackerModule {}
