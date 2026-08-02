import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
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
export class HierarchicalCategoryPickerComponent implements OnChanges, OnInit, OnDestroy {
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
  panelStyle: Record<string, string> = {};

  private scrollParents: EventTarget[] = [];

  constructor(private elementRef: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    this.refreshTree();
    this.browsePath = splitCategoryParts(this.value || '');
    if (this.autoOpen) {
      this.openPanel();
    }
  }

  ngOnDestroy(): void {
    this.detachScrollListeners();
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
    if (this.isOpen) {
      this.closePanel(true);
    } else {
      this.openPanel();
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
    } else {
      // Expand columns may change panel width — re-anchor
      requestAnimationFrame(() => this.updatePanelPosition());
    }
  }

  clear(event: Event): void {
    event.stopPropagation();
    this.commit('');
  }

  commit(value: string): void {
    this.valueChange.emit(value);
    this.closePanel(false);
    this.browsePath = splitCategoryParts(value);
  }

  private openPanel(): void {
    this.isOpen = true;
    this.browsePath = splitCategoryParts(this.value || '');
    this.attachScrollListeners();
    requestAnimationFrame(() => this.updatePanelPosition());
  }

  private closePanel(emitDismiss: boolean): void {
    this.isOpen = false;
    this.panelStyle = {};
    this.detachScrollListeners();
    if (emitDismiss) this.dismissed.emit();
  }

  updatePanelPosition(): void {
    if (!this.isOpen) return;
    const host = this.elementRef.nativeElement;
    const anchor =
      (host.querySelector('.cat-picker-trigger') as HTMLElement | null) || host;
    const rect = anchor.getBoundingClientRect();
    const estimatedWidth = Math.min(520, Math.max(280, rect.width, 280));
    const estimatedHeight = 300;
    const gap = 4;
    const margin = 8;

    let left = rect.right - estimatedWidth;
    left = Math.max(margin, Math.min(left, window.innerWidth - estimatedWidth - margin));

    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

    let top: number;
    if (openUp) {
      top = Math.max(margin, rect.top - gap - estimatedHeight);
    } else {
      top = Math.min(rect.bottom + gap, window.innerHeight - estimatedHeight - margin);
      top = Math.max(margin, top);
    }

    this.panelStyle = {
      position: 'fixed',
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      right: 'auto',
      zIndex: '2000',
      maxWidth: `min(92vw, 520px)`,
      minWidth: `${Math.min(estimatedWidth, window.innerWidth - margin * 2)}px`
    };
  }

  private attachScrollListeners(): void {
    this.detachScrollListeners();
    const parents: EventTarget[] = [window];
    let el: HTMLElement | null = this.elementRef.nativeElement.parentElement;
    while (el) {
      const style = getComputedStyle(el);
      const overflow = `${style.overflow}|${style.overflowX}|${style.overflowY}`;
      if (/(auto|scroll|overlay)/.test(overflow)) {
        parents.push(el);
      }
      el = el.parentElement;
    }
    this.scrollParents = parents;
    for (const t of parents) {
      t.addEventListener('scroll', this.onReposition, true);
    }
    window.addEventListener('resize', this.onReposition);
  }

  private detachScrollListeners(): void {
    for (const t of this.scrollParents) {
      t.removeEventListener('scroll', this.onReposition, true);
    }
    window.removeEventListener('resize', this.onReposition);
    this.scrollParents = [];
  }

  private onReposition = (): void => {
    this.updatePanelPosition();
  };

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen) return;
    const target = event.target as Node;
    if (!this.elementRef.nativeElement.contains(target)) {
      // Panel is inside host, so contains works
      this.closePanel(true);
    }
  }
}
