import { Component, OnInit } from '@angular/core';
import { PortfolioService, WorkspacePortfolio, WorkspaceUser } from '../../services/portfolio.service';

@Component({
  selector: 'app-workspace-panel',
  templateUrl: './workspace-panel.component.html',
  styleUrls: ['./workspace-panel.component.css'],
  standalone: false
})
export class WorkspacePanelComponent implements OnInit {
  loading = true;
  message = '';
  error = '';
  user: WorkspaceUser | null = null;
  cards: WorkspacePortfolio[] = [];
  activeId = 'all';
  writePortfolioId: number | null = null;

  constructor(private portfolios: PortfolioService) {}

  ngOnInit() {
    this.reload();
  }

  get grandTotal(): number {
    return this.cards.reduce((sum, card) => sum + (card.investment_total || 0), 0);
  }

  get writeName(): string {
    const match = this.cards.find((card) => card.id === this.writePortfolioId)
      || this.portfolios.context$.value?.portfolios?.find((card) => card.id === this.writePortfolioId);
    return match?.name || 'the default portfolio';
  }

  isActive(id: number | 'all'): boolean {
    return String(this.activeId) === String(id);
  }

  select(id: number | 'all') {
    this.activeId = String(id);
    this.portfolios.setActive(id);
  }

  reload() {
    this.loading = true;
    this.portfolios.loadContext(true).subscribe({
      next: (res) => {
        this.user = res.data.user;
        this.writePortfolioId = res.data.writePortfolioId;
        this.activeId = this.portfolios.activeId;
        this.portfolios.loadSummary().subscribe({
          next: (summary) => {
            this.cards = summary.data || [];
            this.loading = false;
          },
          error: (err) => this.fail(err, 'Could not load portfolio totals.')
        });
      },
      error: (err) => this.fail(err, 'Could not load users and portfolios.')
    });
  }

  private fail(err: { error?: { error?: string } }, fallback: string) {
    this.loading = false;
    this.error = err?.error?.error || fallback;
  }
}
