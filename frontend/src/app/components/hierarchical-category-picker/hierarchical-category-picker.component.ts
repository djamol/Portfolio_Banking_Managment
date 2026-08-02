import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import {
  buildCategoryTree,
  CategoryTreeNode,
  formatCategoryLabel,
  joinCategoryParts,
  splitCategoryParts
} from '../../utils/category-tree.util';

@Component({
  selector: 'app-hierarchical-category-picker',
  templateUrl: './hierarchical-category-picker.component.html',
  styleUrls: ['./hierarchical-category-picker.component.css'],
  standalone: false
})
export class HierarchicalCategoryPickerComponent implements OnChanges, OnInit {
  @Input() options: string[] = [];
  /** Optional shared tree — avoids rebuilding per instance. */
  @Input() treeInput: CategoryTreeNode[] | null = null;
  @Input() value: string | null | undefined = '';
  @Input() placeholder = 'Select category';
  @Input() allowClear = true;
  /** Open immediately (for row edit-in-place). */
  @Input() autoOpen = false;
  @Output() valueChange = new EventEmitter<string>();
  @Output() dismissed = new EventEmitter<void>();

  isOpen = false;
  tree: CategoryTreeNode[] = [];
  browsePath: string[] = [];

  constructor(private elementRef: ElementRef) {}

  ngOnInit(): void {
    this.refreshTree();
    this.browsePath = splitCategoryParts(this.value || '');
    if (this.autoOpen) {
      this.isOpen = true;
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['options'] || changes['treeInput']) {
      this.refreshTree();
    }
    if (changes['value'] && !this.isOpen) {
      this.browsePath = splitCategoryParts(this.value || '');
    }
  }

  private refreshTree(): void {
    this.tree = this.treeInput?.length ? this.treeInput : buildCategoryTree(this.options || []);
  }

  get displayText(): string {
    const v = (this.value || '').trim();
    if (!v) return this.placeholder;
    return formatCategoryLabel(v, ' → ');
  }

  get columns(): CategoryTreeNode[][] {
    if (!this.isOpen) return [];
    const cols: CategoryTreeNode[][] = [];
    let nodes = this.tree;
    cols.push(nodes);
    for (let i = 0; i < this.browsePath.length; i++) {
      const label = this.browsePath[i];
      const match = nodes.find((n) => n.label === label);
      if (!match || !match.children.length) break;
      nodes = match.children;
      cols.push(nodes);
    }
    return cols;
  }

  toggle(event: Event): void {
    event.stopPropagation();
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.browsePath = splitCategoryParts(this.value || '');
    } else {
      this.dismissed.emit();
    }
  }

  isPathPrefix(colIndex: number, label: string): boolean {
    return this.browsePath[colIndex] === label;
  }

  pickNode(colIndex: number, node: CategoryTreeNode, event: Event): void {
    event.stopPropagation();
    this.browsePath = [...this.browsePath.slice(0, colIndex), node.label];

    if (!node.children.length) {
      const leaf = node.leaves[0] || joinCategoryParts(this.browsePath);
      this.commit(leaf);
      return;
    }

    if (node.leaves.length === 1) {
      this.commit(node.leaves[0]);
    }
  }

  clear(event: Event): void {
    event.stopPropagation();
    this.commit('');
  }

  commit(value: string): void {
    this.valueChange.emit(value);
    this.isOpen = false;
    this.browsePath = splitCategoryParts(value);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen) return;
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen = false;
      this.dismissed.emit();
    }
  }
}
