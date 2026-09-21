import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { ImportDataComponent } from './import-data.component';

@NgModule({
  declarations: [ImportDataComponent],
  imports: [
    SharedModule,
    RouterModule.forChild([{ path: '', component: ImportDataComponent }])
  ]
})
export class ImportDataModule {}
