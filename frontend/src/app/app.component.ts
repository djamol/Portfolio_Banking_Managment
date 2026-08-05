import { Component } from '@angular/core';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'Portfolio Financial Management';
  menuOpen = false;
  openGroup: 'portfolio' | 'insights' | 'data' | null = null;

  constructor(public authService: AuthService) {}

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
