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
export class HierarchicalCategoryPickerComponent implements OnChanges {
  @Input() options: string[] = [];
  @Input() value: string | null | undefined = '';
  @Input() placeholder = 'Select category';
  @Input() allowClear = true;
  @Output() valueChange = new EventEmitter<string>();

  isOpen = false;
  tree: CategoryTreeNode[] = [];
  /** Currently highlighted path while browsing (labels). */
  browsePath: string[] = [];

  constructor(private elementRef: ElementRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['options']) {
      this.tree = buildCategoryTree(this.options || []);
    }
    if (changes['value'] && !this.isOpen) {
      this.browsePath = splitCategoryParts(this.value || '');
    }
  }

  get displayText(): string {
    const v = (this.value || '').trim();
    if (!v) return this.placeholder;
    return formatCategoryLabel(v, ' → ');
  }

  get columns(): CategoryTreeNode[][] {
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
    }
  }

  isPathPrefix(colIndex: number, label: string): boolean {
    return this.browsePath[colIndex] === label;
  }

  pickNode(colIndex: number, node: CategoryTreeNode, event: Event): void {
    event.stopPropagation();
    this.browsePath = [...this.browsePath.slice(0, colIndex), node.label];

    // Leaf: commit the stored category value
    if (!node.children.length) {
      const leaf = node.leaves[0] || joinCategoryParts(this.browsePath);
      this.commit(leaf);
      return;
    }

    // Branch with a single concrete value and no further useful choice
    if (node.leaves.length === 1) {
      this.commit(node.leaves[0]);
    }
    // else keep open so user can pick the next level
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
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen = false;
    }
  }
}
