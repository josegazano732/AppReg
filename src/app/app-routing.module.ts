import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./layout/dashboard.component').then(c => c.DashboardComponent),
    children: [
      {
        path: '',
        title: 'Inicio | AppReg',
        loadChildren: () => import('./features/home/home.module').then(m => m.HomeModule)
      },
      {
        path: 'registro',
        title: 'Registro Diario | AppReg',
        loadComponent: () => import('./features/registro-diario/registro-diario.component').then(c => c.RegistroDiarioComponent)
      },
      {
        path: 'ingresos-caja',
        title: 'Ingresos de Caja | AppReg',
        loadComponent: () => import('./features/ingresos-caja/ingresos-caja.component').then(c => c.IngresosCajaComponent)
      },
      {
        path: 'control-caja',
        title: 'Control de Caja | AppReg',
        loadComponent: () => import('./features/control-caja/control-caja.component').then(c => c.ControlCajaComponent)
      },
      {
        path: 'cierre',
        title: 'Cierre Diario | AppReg',
        loadComponent: () => import('./features/cierre-diario/cierre-diario.component').then(c => c.CierreDiarioComponent)
      },
      {
        path: 'trazabilidad-caja',
        title: 'Trazabilidad de Caja | AppReg',
        loadComponent: () => import('./features/trazabilidad-caja/trazabilidad-caja.component').then(c => c.TrazabilidadCajaComponent)
      },
      {
        path: 'movimientos-medios',
        title: 'Movimientos por Medio | AppReg',
        loadComponent: () => import('./features/movimientos-medios/movimientos-medios.component').then(c => c.MovimientosMediosComponent)
      },
      {
        path: 'conciliacion-bancaria',
        title: 'Conciliacion Bancaria | AppReg',
        loadComponent: () => import('./features/conciliacion-bancaria/conciliacion-bancaria.component').then(c => c.ConciliacionBancariaComponent)
      },
      {
        path: 'egresos-caja',
        title: 'Egresos de Caja | AppReg',
        loadComponent: () => import('./features/gastos-diarios/gastos-diarios.component').then(c => c.GastosDiariosComponent)
      },
      {
        path: 'gastos-diarios',
        redirectTo: 'egresos-caja',
        pathMatch: 'full'
      },
      {
        path: 'configuracion',
        title: 'Configuracion | AppReg',
        loadComponent: () => import('./features/configuracion/configuracion.component').then(c => c.ConfiguracionComponent)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'top' })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
