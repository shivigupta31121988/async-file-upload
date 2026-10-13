export type UploadStatus = 'uploading' | 'complete' | 'error' | 'cancelled';

export interface UploadRecord {
  id: string;
  originalFilename: string;
  extension: string;
  mimeType: string;
  bytes: number;
  uploader: string;
  startedAt: string;
  uploadedAt: string;
  durationMs: number;
  downloadUrl: string;
}

export interface UploadTask {
  id: string;
  originalFilename: string;
  extension: string;
  bytes: number;
  uploader: string;
  progress: number | null;
  status: UploadStatus;
  durationMs?: number;
  serverId?: string;
  error?: string;
}
