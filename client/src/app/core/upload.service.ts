import { HttpClient, HttpErrorResponse, HttpEventType, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, map, Observable, Subscription } from 'rxjs';
import { UploadRecord, UploadTask } from './upload.models';

@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly tasksSubject = new BehaviorSubject<UploadTask[]>([]);
  readonly tasks$ = this.tasksSubject.asObservable();
  private readonly requests = new Map<string, Subscription>();

  constructor(private readonly http: HttpClient) {}

  startUpload(file: File, uploader: string): string {
    const taskId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const extension = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : '';
    const task: UploadTask = {
      id: taskId,
      originalFilename: file.name,
      extension,
      bytes: file.size,
      uploader: uploader.trim(),
      progress: 0,
      status: 'uploading'
    };
    this.tasksSubject.next([...this.tasksSubject.value, task]);

    const formData = new FormData();
    formData.append('file', file, file.name);
    const headers = new HttpHeaders({ 'x-uploader': uploader.trim() || 'Unknown' });

    const request = this.http.post<UploadRecord>('/api/uploads', formData, {
      headers,
      observe: 'events',
      reportProgress: true
    }).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const progress = event.total
            ? Math.min(100, Math.round((event.loaded / event.total) * 100))
            : null;
          this.patchTask(taskId, { progress });
        } else if (event instanceof HttpResponse && event.body) {
          this.patchTask(taskId, {
            status: 'complete',
            progress: 100,
            serverId: event.body.id,
            durationMs: event.body.durationMs
          });
        }
      },
      error: (error: HttpErrorResponse) => {
        const message = typeof error.error?.error === 'string'
          ? error.error.error
          : error.message || 'Upload failed. Check the API and try again.';
        this.patchTask(taskId, { status: 'error', error: message });
        this.requests.delete(taskId);
      },
      complete: () => this.requests.delete(taskId)
    });

    this.requests.set(taskId, request);
    return taskId;
  }

  cancelUpload(taskId: string): void {
    const request = this.requests.get(taskId);
    if (!request) return;
    request.unsubscribe();
    this.requests.delete(taskId);
    this.patchTask(taskId, { status: 'cancelled', error: 'Upload cancelled.' });
  }

  dismiss(taskId: string): void {
    const task = this.tasksSubject.value.find((item) => item.id === taskId);
    if (!task || task.status === 'uploading') return;
    this.tasksSubject.next(this.tasksSubject.value.filter((item) => item.id !== taskId));
  }

  clearFinished(): void {
    this.tasksSubject.next(this.tasksSubject.value.filter((task) => task.status === 'uploading'));
  }

  getHistory(limit = 50): Observable<UploadRecord[]> {
    return this.http.get<{ items: UploadRecord[] }>(`/api/uploads?limit=${limit}`).pipe(
      map((response) => response.items || [])
    );
  }

  private patchTask(taskId: string, changes: Partial<UploadTask>): void {
    this.tasksSubject.next(this.tasksSubject.value.map((task) =>
      task.id === taskId ? { ...task, ...changes } : task
    ));
  }
}
