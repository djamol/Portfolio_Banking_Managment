import { Component, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { AuthService } from './services/auth.service';
import { PortfolioService, WorkspacePortfolio } from './services/portfolio.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  title = 'Portfolio Financial Management';
  menuOpen = false;
  openGroup: 'portfolio' | 'insights' | 'data' | null = null;
  portfolios: WorkspacePortfolio[] = [];
  activePortfolioId = 'all';

  constructor(
    public authService: AuthService,
    private portfolioService: PortfolioService,
    private router: Router
  ) {}

  ngOnInit() {
    this.activePortfolioId = this.portfolioService.activeId;
    this.portfolioService.context$.subscribe((ctx) => {
      this.portfolios = ctx?.portfolios || [];
      this.activePortfolioId = this.portfolioService.activeId;
    });
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.loadPortfolios();
    });
    this.loadPortfolios();
  }

  loadPortfolios() {
    if (!this.authService.isAuthenticated()) {
      this.portfolios = [];
      return;
    }
    const pending = this.portfolioService.ensureContext();
    if (!pending) {
      this.portfolios = this.portfolioService.context$.value?.portfolios || [];
      this.activePortfolioId = this.portfolioService.activeId;
      return;
    }
    pending.subscribe({
      next: (res) => {
        this.portfolios = res.data?.portfolios || [];
        this.activePortfolioId = this.portfolioService.activeId;
      },
      error: () => {
        this.portfolios = [];
      }
    });
  }

  onPortfolioChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    this.activePortfolioId = value;
    this.portfolioService.setActive(value);
    this.closeMenu();
  }

  toggleGroup(group: 'portfolio' | 'insights' | 'data') {
    this.openGroup = this.openGroup === group ? null : group;
  }

  closeMenu() {
    this.menuOpen = false;
    this.openGroup = null;
  }

  logout() {
    this.closeMenu();
    this.authService.logout();
  }
}
