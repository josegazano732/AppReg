import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './header.component.html',
  styles: [':host{display:block;background:#1976d2;color:#fff;padding:1rem;} a{color:#fff;text-decoration:none}']
})
export class HeaderComponent { }
