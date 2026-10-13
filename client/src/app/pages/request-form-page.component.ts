import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './request-form-page.component.html'
})
export class RequestFormPageComponent {
  details = {
    title: '',
    requester: '',
    department: '',
    priority: 'Normal',
    notes: ''
  };
  saved = false;
  savedTitle = '';

  save(form: NgForm): void {
    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }
    this.savedTitle = this.details.title.trim();
    this.saved = true;
  }

  onEdit(): void {
    this.saved = false;
  }
}
