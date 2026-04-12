import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface DashboardNavItem {
  label: string;
  route: string;
  exact?: boolean;
  icon: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent {
  sidenavOpen = signal(true);
  today = new Date();
  navItems: DashboardNavItem[] = [
    { label: 'Inicio', route: '/', exact: true, icon: 'home' },
    { label: 'Registro diario', route: '/registro', icon: 'receipt' },
    { label: 'Ingresos de caja', route: '/ingresos-caja', icon: 'arrow-up-circle' },
    { label: 'Egresos de caja', route: '/egresos-caja', icon: 'arrow-down-circle' },
    { label: 'Control de caja', route: '/control-caja', icon: 'wallet' },
    { label: 'Cierre diario', route: '/cierre', icon: 'shield-check' },
    { label: 'Trazabilidad caja', route: '/trazabilidad-caja', icon: 'activity' },
    { label: 'Configuracion', route: '/configuracion', icon: 'settings' }
  ];

  toggle() {
    this.sidenavOpen.update(v => !v);
  }

  closeMenu() {
    this.sidenavOpen.set(false);
  }

  closeForMobile() {
    if (window.innerWidth < 992) {
      this.closeMenu();
    }
  }
}
