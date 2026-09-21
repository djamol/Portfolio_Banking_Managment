import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { InvestmentListComponent } from './investment-list.component';
import { InvestmentFormComponent } from '../investment-form/investment-form.component';

@NgModule({
  declarations: [InvestmentListComponent, InvestmentFormComponent],
  imports: [
    SharedModule,
    RouterModule.forChild([
      { path: '', component: InvestmentListComponent },
      { path: 'new', component: InvestmentFormComponent },
      { path: 'edit/:id', component: InvestmentFormComponent }
    ])
  ]
})
export class InvestmentsModule {}
