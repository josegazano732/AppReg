import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HeaderComponent } from './components/header/header.component';

@NgModule({
  imports: [CommonModule, FormsModule, ReactiveFormsModule, HeaderComponent],
  exports: [CommonModule, FormsModule, ReactiveFormsModule, HeaderComponent]
})
export class SharedModule { }
