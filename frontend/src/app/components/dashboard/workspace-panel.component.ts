import { Component, OnInit } from '@angular/core';
import { PortfolioService, WorkspacePortfolio, WorkspaceUser } from '../../services/portfolio.service';

const COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2'];

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
  users: WorkspaceUser[] = [];
  cards: WorkspacePortfolio[] = [];
  activeId = 'all';
  writePortfolioId: number | null = null;
  colors = COLORS;
  drafts: Record<number, string> = {};
  userForm = { username: '', display_name: '', password: '', role: 'member' };
  portfolioForm = { name: '', description: '', color: COLORS[0], owner_user_id: null as number | null };

  constructor(private portfolios: PortfolioService) {}

  ngOnInit() {
    this.reload();
  }

  get isAdmin(): boolean {
    return this.user?.role === 'admin';
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
        this.users = res.data.users || [];
        this.writePortfolioId = res.data.writePortfolioId;
        this.activeId = this.portfolios.activeId;
        if (!this.portfolioForm.owner_user_id && this.user) {
          this.portfolioForm.owner_user_id = this.user.id;
        }
        this.portfolios.loadSummary().subscribe({
          next: (summary) => {
            this.cards = summary.data || [];
            this.drafts = {};
            this.cards.forEach((card) => {
              this.drafts[card.id] = card.name;
            });
            this.loading = false;
          },
          error: (err) => this.fail(err, 'Could not load portfolio totals.')
        });
      },
      error: (err) => this.fail(err, 'Could not load users and portfolios.')
    });
  }

  createUser() {
    this.error = '';
    this.message = '';
    this.portfolios.createUser(this.userForm).subscribe({
      next: (res) => {
        this.message = `Added ${res.data.user.display_name}. They can sign in and use their own portfolio.`;
        this.userForm = { username: '', display_name: '', password: '', role: 'member' };
        this.reload();
      },
      error: (err) => this.fail(err, 'Could not add that user.')
    });
  }

  createPortfolio() {
    this.error = '';
    this.message = '';
    this.portfolios.createPortfolio({
      name: this.portfolioForm.name,
      description: this.portfolioForm.description,
      color: this.portfolioForm.color,
      owner_user_id: this.isAdmin ? this.portfolioForm.owner_user_id : this.user?.id
    }).subscribe({
      next: (res) => {
        this.message = `Created ${res.data.name}.`;
        this.portfolioForm.name = '';
        this.portfolioForm.description = '';
        this.reload();
      },
      error: (err) => this.fail(err, 'Could not create that portfolio.')
    });
  }

  saveName(card: WorkspacePortfolio) {
    const name = (this.drafts[card.id] || '').trim();
    if (!name || name === card.name) return;
    this.portfolios.updatePortfolio(card.id, { name }).subscribe({
      next: () => {
        this.message = `Renamed to ${name}.`;
        this.reload();
      },
      error: (err) => this.fail(err, 'Could not rename that portfolio.')
    });
  }

  makeDefault(card: WorkspacePortfolio) {
    this.portfolios.updatePortfolio(card.id, { is_default: true }).subscribe({
      next: () => {
        this.message = `${card.name} is now the default place for new holdings when All portfolios is selected.`;
        this.reload();
      },
      error: (err) => this.fail(err, 'Could not change the default portfolio.')
    });
  }

  remove(card: WorkspacePortfolio) {
    if (!window.confirm(`Delete ${card.name}? This only works when it has no holdings or bank accounts.`)) return;
    this.portfolios.deletePortfolio(card.id).subscribe({
      next: () => {
        if (String(this.activeId) === String(card.id)) this.portfolios.setActive('all');
        this.message = `Deleted ${card.name}.`;
        this.reload();
      },
      error: (err) => this.fail(err, 'Could not delete that portfolio.')
    });
  }

  setRole(person: WorkspaceUser, role: string) {
    if (!role || role === person.role) return;
    this.portfolios.updateUser(person.id, { role }).subscribe({
      next: () => this.reload(),
      error: (err) => this.fail(err, 'Could not change that role.')
    });
  }

  toggleActive(person: WorkspaceUser) {
    const next = person.is_active === 0 ? 1 : 0;
    this.portfolios.updateUser(person.id, { is_active: next }).subscribe({
      next: () => this.reload(),
      error: (err) => this.fail(err, 'Could not update that user.')
    });
  }

  private fail(err: { error?: { error?: string } }, fallback: string) {
    this.loading = false;
    this.error = err?.error?.error || fallback;
  }
}
