import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { formatBytes, formatDuration } from './core/format';
import { UploadService } from './core/upload.service';
import { UploadTask } from './core/upload.models';

@Component({
  selector: 'fv-root',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.component.html'
})
export class AppComponent {
  readonly uploads$ = this.uploadService.tasks$;
  collapsed = false;

  constructor(private readonly uploadService: UploadService) {}

  activeCount(tasks: UploadTask[]): number {
    return tasks.filter((task) => task.status === 'uploading').length;
  }

  formatBytes = formatBytes;
  formatDuration = formatDuration;

  cancel(id: string): void {
    this.uploadService.cancelUpload(id);
  }

  dismiss(id: string): void {
    this.uploadService.dismiss(id);
  }

  clearFinished(): void {
    this.uploadService.clearFinished();
  }
}
