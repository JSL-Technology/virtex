
import { Injectable, ApplicationRef, createComponent, EnvironmentInjector, inject, Type, ComponentRef } from '@angular/core';
import { PasswordConfirmModalComponent } from '../../shared/components/password-confirm-modal/password-confirm-modal.component';

@Injectable({
  providedIn: 'root'
})
export class StepUpService {
  private appRef = inject(ApplicationRef);
  private injector = inject(EnvironmentInjector);

  private stepUpToken: string | null = null;

  async requireStepUp(scope: string): Promise<string> {
    // 1. Create component programmatically
    const componentRef = createComponent(PasswordConfirmModalComponent, {
      environmentInjector: this.injector
    });

    // 2. Set scope
    componentRef.instance.scope = scope;

    // 3. Attach to DOM
    document.body.appendChild(componentRef.location.nativeElement);
    this.appRef.attachView(componentRef.hostView);

    // 4. Return promise
    return new Promise<string>((resolve, reject) => {
      componentRef.instance.resolve = (token: string) => {
        this.stepUpToken = token;
        this.destroyComponent(componentRef);
        resolve(token);
      };

      componentRef.instance.reject = (reason: any) => {
        this.destroyComponent(componentRef);
        reject(reason);
      };
    }).finally(() => {
        // Automatically clear token after a short delay or allow the caller to use it once.
        // The implementation requires it to be used in the next request.
    });
  }

  /**
   * Returns the current step-up token and CLEARS IT immediately from memory
   * to ensure single-use and security.
   */
  consumeToken(): string | null {
    const token = this.stepUpToken;
    this.stepUpToken = null;
    return token;
  }

  private destroyComponent(componentRef: ComponentRef<PasswordConfirmModalComponent>) {
    this.appRef.detachView(componentRef.hostView);
    componentRef.destroy();
  }
}
