import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatBytes } from '../core/format';
import { UploadService } from '../core/upload.service';

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './upload-page.component.html'
})
export class UploadPageComponent {
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  selectedFile: File | null = null;
  uploader = '';
  dragging = false;
  message = '';
  formatBytes = formatBytes;

  constructor(private readonly uploadService: UploadService) {}

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    if (file) this.chooseFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
    const file = event.dataTransfer?.files.item(0);
    if (file) this.chooseFile(file);
  }

  removeFile(): void {
    this.selectedFile = null;
    this.message = '';
    if (this.fileInput) this.fileInput.nativeElement.value = '';
  }

  startUpload(event: Event): void {
    event.preventDefault();
    if (!this.selectedFile) {
      this.message = 'Choose a file before starting the upload.';
      return;
    }
    if (!this.uploader.trim()) {
      this.message = 'Enter the uploader name for the activity log.';
      return;
    }

    const filename = this.selectedFile.name;
    this.uploadService.startUpload(this.selectedFile, this.uploader);
    this.message = `${filename} is uploading in the background. You can continue to the request form.`;
    this.selectedFile = null;
    if (this.fileInput) this.fileInput.nativeElement.value = '';
  }

  private chooseFile(file: File): void {
    this.selectedFile = file;
    this.message = '';
  }
}
