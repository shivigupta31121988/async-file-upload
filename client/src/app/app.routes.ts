import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'upload' },
  {
    path: 'upload',
    loadComponent: () => import('./pages/upload-page.component').then((module) => module.UploadPageComponent)
  },
  {
    path: 'intake',
    loadComponent: () => import('./pages/request-form-page.component').then((module) => module.RequestFormPageComponent)
  },
  {
    path: 'activity',
    loadComponent: () => import('./pages/activity-page.component').then((module) => module.ActivityPageComponent)
  },
  { path: '**', redirectTo: 'upload' }
];
