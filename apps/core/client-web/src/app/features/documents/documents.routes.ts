import { Routes } from '@angular/router';
import { DocumentsLayout } from './layout/documents.layout';

export const DOCUMENTS_ROUTES: Routes = [
    {
        path: '',
        component: DocumentsLayout,
        children: [
            {
                path: 'repository',
                title: 'PAGE_TITLES.DOCUMENT_REPOSITORY',
                loadComponent: () => import('./repository/repository.page').then(m => m.RepositoryPage)
            },
            {
                path: 'templates',
                title: 'PAGE_TITLES.DOCUMENT_TEMPLATES',
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