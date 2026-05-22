import { Routes } from '@angular/router';
import { DocumentsLayout } from './layout/documents.layout';

export const DOCUMENTS_ROUTES: Routes = [
    {
        path: '',
        component: DocumentsLayout,
        children: [
            {
                path: 'repository',
                title: 'Document Repository',
                loadComponent: () => import('./repository/repository.page').then(m => m.RepositoryPage)
            },
            {
                path: 'templates',
                title: 'Document Templates',
                loadComponent: () => import('./templates/templates.page').then(m => m.TemplatesPage)
            },
            {
                path: '',
                redirectTo: 'repository',
                pathMatch: 'full'
            }
        ]
    }
];