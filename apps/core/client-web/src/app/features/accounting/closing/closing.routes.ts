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
            // `tasks` used to live here: four hardcoded tasks assigned to invented people
            // ("Carlos López", "Ana Pérez"), with due dates in July 2025. Nothing in the product
            // models a closing task, its owner or its due date — there is no table, no endpoint
            // and no concept — so the page could only ever have shown those four rows to every
            // tenant. The real checks a period must pass are computed by `ClosingChecklistService`
            // and shown by `month-end` and `checklist`.
            {
                path: '',
                redirectTo: 'month-end',
                pathMatch: 'full'
            }
        ]
    }
];