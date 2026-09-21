import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MultiSelectFilterComponent } from '../components/multi-select-filter/multi-select-filter.component';

@NgModule({
  declarations: [MultiSelectFilterComponent],
  imports: [CommonModule, FormsModule, RouterModule],
  exports: [CommonModule, FormsModule, RouterModule, MultiSelectFilterComponent]
})
export class SharedModule {}
