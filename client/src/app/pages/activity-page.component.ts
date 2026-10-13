import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { UploadRecord } from '../core/upload.models';
import { formatBytes, formatDuration } from '../core/format';
import { UploadService } from '../core/upload.service';

@Component({
  standalone: true,
  imports: [CommonModule],
  templateUrl: './activity-page.component.html'
})
export class ActivityPageComponent implements OnInit {
  records: UploadRecord[] = [];
  loading = false;
  error = '';
  formatBytes = formatBytes;
  formatDuration = formatDuration;

  constructor(private readonly uploadService: UploadService) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = '';
    this.uploadService.getHistory(50).subscribe({
      next: (records) => {
        this.records = records;
        this.loading = false;
      },
      error: (error: unknown) => {
        this.error = error instanceof Error ? error.message : 'Could not load activity. Check that the API is running.';
        this.loading = false;
      }
    });
  }

  downloadUrl(record: UploadRecord): string {
    return record.downloadUrl || `/api/uploads/${record.id}/download`;
  }

  trackById(_index: number, record: UploadRecord): string {
    return record.id;
  }
}
