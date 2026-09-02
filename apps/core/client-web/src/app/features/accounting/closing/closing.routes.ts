import { Routes } from '@angular/router';
import { ClosingLayout } from './layout/closing.layout';

export const CLOSING_ROUTES: Routes = [
    {
        path: '',
        component: ClosingLayout,
        children: [
            {
                path: 'month-end',
                title: 'PAGE_TITLES.CLOSE_MONTH',
                loadComponent: () => import('./month-end-close/month-end-close.page').then(m => m.MonthEndClosePage)
            },
            {
                path: 'annual-close',
                title: 'PAGE_TITLES.CLOSE_YEAR',
                loadComponent: () => import('./annual-close/annual-close.page').then(m => m.AnnualClosePage)
            },
            {
                path: 'checklist',
                title: 'PAGE_TITLES.CLOSING_CHECKLISTS',
                loadComponent: () => import('./checklist/checklist.page').then(m => m.ChecklistPage)
            },
            {
                path: 'tasks',
                title: 'PAGE_TITLES.CLOSING_TASKS',
                loadComponent: () => import('./tasks/tasks.page').then(m => m.TasksPage)
            },
            // Aquí irían las rutas para /annual-close, /checklist, etc.
            {
                path: '',
                redirectTo: 'month-end',
                pathMatch: 'full'
            }
        ]
    }
];