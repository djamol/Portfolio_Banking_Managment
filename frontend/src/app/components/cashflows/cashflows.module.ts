import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { CashflowsComponent } from './cashflows.component';

@NgModule({
  declarations: [CashflowsComponent],
  imports: [
    SharedModule,
    RouterModule.forChild([{ path: '', component: CashflowsComponent }])
  ]
})
export class CashflowsModule {}
