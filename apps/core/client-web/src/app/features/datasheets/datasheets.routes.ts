
import { Routes } from '@angular/router';

export const DATASHEET_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/datasheet-list/datasheet-list.page').then(m => m.DatasheetListPage)
  },
  {
    path: ':id',
    loadComponent: () => import('./pages/datasheet-editor/datasheet-editor.page').then(m => m.DatasheetEditorPage)
  }
];
