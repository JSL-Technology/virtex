import { Directive, Input, OnDestroy, TemplateRef, ViewContainerRef, inject } from '@angular/core';
import { AuthService } from '../../core/services/auth';
import { combineLatest, Subscription } from 'rxjs';

@Directive({
    selector: '[hasPermission]',
    standalone: true
})
export class HasPermissionDirective implements OnDestroy {
    private authService = inject(AuthService);
    private templateRef = inject(TemplateRef<any>);
    private viewContainer = inject(ViewContainerRef);

    private requiredPermissions: string[] = [];
    private authSubscription: Subscription;

  constructor() {
        // ✅ Escuchar cambios tanto en autenticación como en permisos
        this.authSubscription = combineLatest([
            this.authService.isAuthenticated$,
            this.authService.getPermissions$()
        ]).subscribe(() => {
            this.updateView();
        });
    }

    @Input()
    set hasPermission(value: string | string[] | undefined | null) {
        this.requiredPermissions = Array.isArray(value) ? value : (value ? [value] : []);
        this.updateView();
    }

    private updateView(): void {
        if (this.authService.hasPermissions(this.requiredPermissions)) {
            if (!this.viewContainer.length) {
                this.viewContainer.createEmbeddedView(this.templateRef);
            }
        } else {
            this.viewContainer.clear();
        }
    }

    ngOnDestroy(): void {
        this.authSubscription.unsubscribe();
    }
}