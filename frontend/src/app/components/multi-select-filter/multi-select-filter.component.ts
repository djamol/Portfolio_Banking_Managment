import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges
} from '@angular/core';
import { buildCategoryTree, CategoryTreeNode, formatCategoryLabel } from '../../utils/category-tree.util';

@Component({
  selector: 'app-multi-select-filter',
  templateUrl: './multi-select-filter.component.html',
  styleUrls: ['./multi-select-filter.component.css'],
  standalone: false
})
export class MultiSelectFilterComponent implements OnChanges {
  @Input() label = '';
  @Input() options: string[] = [];
  @Input() allLabel = 'All';
  @Input() placeholder = 'Select...';
  @Input() selected: string[] = [];
  /** When true, options like Expense_Loan_EMI render as Main › Sub › Detail checkboxes. */
  @Input() hierarchical = false;
  @Output() selectedChange = new EventEmitter<string[]>();

  isOpen = false;
  tree: CategoryTreeNode[] = [];

  constructor(private elementRef: ElementRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['options'] || changes['hierarchical']) {
      this.tree = this.hierarchical ? buildCategoryTree(this.options || []) : [];
    }
  }

  get displayText(): string {
    if (!this.selected.length) {
      return this.placeholder;
    }
    if (this.options.length > 0 && this.selected.length === this.options.length) {
      return `${this.allLabel} (${this.options.length})`;
    }
    if (this.selected.length === 1) {
      return this.hierarchical ? formatCategoryLabel(this.selected[0]) : this.selected[0];
    }
    return `${this.selected.length} selected`;
  }

  isSelected(option: string): boolean {
    return this.selected.includes(option);
  }

  isAllSelected(): boolean {
    return this.options.length > 0 && this.selected.length === this.options.length;
  }

  isIndeterminate(): boolean {
    return this.selected.length > 0 && this.selected.length < this.options.length;
  }

  nodeChecked(node: CategoryTreeNode): boolean {
    return node.leaves.length > 0 && node.leaves.every((l) => this.selected.includes(l));
  }

  nodeIndeterminate(node: CategoryTreeNode): boolean {
    const n = node.leaves.filter((l) => this.selected.includes(l)).length;
    return n > 0 && n < node.leaves.length;
  }

  toggleDropdown(event: Event): void {
    event.stopPropagation();
    this.isOpen = !this.isOpen;
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.emitChange(checked ? [...this.options] : []);
  }

  toggleOption(option: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = checked
      ? [...this.selected, option]
      : this.selected.filter((value) => value !== option);
    this.emitChange(next);
  }

  toggleNode(node: CategoryTreeNode, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const leafSet = new Set(node.leaves);
    let next: string[];
    if (checked) {
      next = [...new Set([...this.selected, ...node.leaves])];
    } else {
      next = this.selected.filter((v) => !leafSet.has(v));
    }
    this.emitChange(next);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen = false;
    }
  }

  trackNode(_: number, node: CategoryTreeNode): string {
    return node.key;
  }

  private emitChange(values: string[]): void {
    this.selectedChange.emit(values);
  }
}
