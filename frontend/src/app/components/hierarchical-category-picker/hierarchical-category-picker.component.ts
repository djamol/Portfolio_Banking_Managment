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
  MAX_CATEGORY_DEPTH,
  sanitizeCategorySegment,
  splitCategoryParts
} from '../../utils/category-tree.util';

@Component({
  selector: 'app-hierarchical-category-picker',
  templateUrl: './hierarchical-category-picker.component.html',
  styleUrls: ['./hierarchical-category-picker.component.css'],
  standalone: false
})
export class HierarchicalCategoryPickerComponent implements OnChanges, OnInit, OnDestroy {
  readonly maxDepth = MAX_CATEGORY_DEPTH;

  @Input() options: string[] = [];
  /** Optional shared tree — avoids rebuilding per instance. */
  @Input() treeInput: CategoryTreeNode[] | null = null;
  @Input() value: string | null | undefined = '';
  @Input() placeholder = 'Select category';
  @Input() allowClear = true;
  /** Open immediately (for row edit-in-place). */
  @Input() autoOpen = false;
  @Output() valueChange = new EventEmitter<string>();
  /** Fired when user creates a new category path (so parent can merge into options). */
  @Output() categoryCreated = new EventEmitter<string>();
  @Output() dismissed = new EventEmitter<void>();

  isOpen = false;
  tree: CategoryTreeNode[] = [];
  browsePath: string[] = [];
  panelStyle: Record<string, string> = {};
  newSegment = '';
  addError = '';

  private scrollParents: EventTarget[] = [];

  constructor(private elementRef: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    this.refreshTree();
    this.browsePath = splitCategoryParts(this.value || '').slice(0, MAX_CATEGORY_DEPTH);
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
      this.browsePath = splitCategoryParts(this.value || '').slice(0, MAX_CATEGORY_DEPTH);
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

  get canAddChild(): boolean {
    return this.browsePath.length < MAX_CATEGORY_DEPTH;
  }

  get canSelectCurrentPath(): boolean {
    return this.browsePath.length > 0;
  }

  get currentPathLabel(): string {
    return this.browsePath.length ? this.browsePath.join(' → ') : '';
  }

  get addHint(): string {
    if (this.browsePath.length === 0) {
      return `New root or path (max ${MAX_CATEGORY_DEPTH} levels)`;
    }
    const remaining = MAX_CATEGORY_DEPTH - this.browsePath.length;
    return `Add under ${this.browsePath.join(' → ')} (${remaining} level${remaining === 1 ? '' : 's'} left)`;
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
    this.addError = '';
    this.newSegment = '';

    // Always expand when children exist so 3rd/4th levels are reachable
    // (even if there is only one leaf under this branch).
    if (node.children.length) {
      requestAnimationFrame(() => this.updatePanelPosition());
      return;
    }

    const leaf = node.leaves[0] || joinCategoryParts(this.browsePath);

    // At depth < max, keep panel open so user can Add a deeper subcategory
    // (e.g. under Expense → Land → Purchase add Cheque).
    if (this.browsePath.length < MAX_CATEGORY_DEPTH) {
      requestAnimationFrame(() => this.updatePanelPosition());
      return;
    }

    this.commit(leaf);
  }

  /** Select the path currently browsed (intermediate or leaf). */
  selectCurrentPath(event: Event): void {
    event.stopPropagation();
    if (!this.browsePath.length) return;
    const path = joinCategoryParts(this.browsePath.slice(0, MAX_CATEGORY_DEPTH));
    this.commitNewOrExisting(path);
  }

  addCategory(event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.addError = '';

    const segment = sanitizeCategorySegment(this.newSegment);
    if (!segment) {
      this.addError = 'Enter a category name';
      return;
    }

    if (this.browsePath.length >= MAX_CATEGORY_DEPTH) {
      this.addError = `Max depth is ${MAX_CATEGORY_DEPTH} (e.g. Expense → Land → Purchase → Cheque)`;
      return;
    }

    const nextPath = [...this.browsePath, segment];
    if (nextPath.length > MAX_CATEGORY_DEPTH) {
      this.addError = `Max depth is ${MAX_CATEGORY_DEPTH}`;
      return;
    }

    const full = joinCategoryParts(nextPath);
    this.newSegment = '';
    this.browsePath = nextPath;

    // If still under max depth and user might add another level, keep panel open
    // but commit so the value is set; also register the new category.
    this.commitNewOrExisting(full, { keepOpen: nextPath.length < MAX_CATEGORY_DEPTH });
  }

  private commitNewOrExisting(value: string, opts: { keepOpen?: boolean } = {}): void {
    const exists = (this.options || []).some((o) => o === value);
    if (!exists) {
      this.categoryCreated.emit(value);
      // Locally refresh so new node appears if panel stays open
      this.options = [...(this.options || []), value];
      this.refreshTree();
    }
    if (opts.keepOpen) {
      this.valueChange.emit(value);
      requestAnimationFrame(() => this.updatePanelPosition());
      return;
    }
    this.commit(value);
  }

  clear(event: Event): void {
    event.stopPropagation();
    this.commit('');
  }

  commit(value: string): void {
    this.valueChange.emit(value);
    this.closePanel(false);
    this.browsePath = splitCategoryParts(value).slice(0, MAX_CATEGORY_DEPTH);
  }

  private openPanel(): void {
    this.isOpen = true;
    this.browsePath = splitCategoryParts(this.value || '').slice(0, MAX_CATEGORY_DEPTH);
    this.newSegment = '';
    this.addError = '';
    this.attachScrollListeners();
    requestAnimationFrame(() => this.updatePanelPosition());
  }

  private closePanel(emitDismiss: boolean): void {
    this.isOpen = false;
    this.panelStyle = {};
    this.newSegment = '';
    this.addError = '';
    this.detachScrollListeners();
    if (emitDismiss) this.dismissed.emit();
  }

  updatePanelPosition(): void {
    if (!this.isOpen) return;
    const host = this.elementRef.nativeElement;
    const anchor =
      (host.querySelector('.cat-picker-trigger') as HTMLElement | null) || host;
    const rect = anchor.getBoundingClientRect();
    const colCount = Math.max(1, this.columns.length);
    const estimatedWidth = Math.min(720, Math.max(280, colCount * 150 + 24));
    const estimatedHeight = 340;
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
      maxWidth: `min(96vw, 720px)`,
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
      this.closePanel(true);
    }
  }
}
