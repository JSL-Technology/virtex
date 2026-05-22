import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';

@Injectable({
  providedIn: 'root',
})
export class ErrorHandlerService {
  constructor(private translate: TranslateService) {}

  handleError(operation: string, error: HttpErrorResponse): Observable<never> {
    let customErrorMessage =
      'Ocurrió un error inesperado. Por favor, intenta más tarde.';
    console.error(
      `Error en la operación '${operation}'. Código: ${error.status}`,
      error.error
    );

    if (error.error instanceof ErrorEvent) {
      customErrorMessage = `Error de red: ${error.error.message}`;
    } else {
      const serverError = error.error;

      // Check for structured AuthError code or SaasError code
      // Priority: 'error' (the code) > 'message' (the human readable text)
      // The backend SaasException sends { message: "...", error: "SAAS_..." }
      const errorCode = serverError?.error || serverError?.message;

      if (typeof errorCode === 'string') {
          if (errorCode.startsWith('AUTH_')) {
              const translationKey = `LOGIN.ERRORS.${errorCode}`;
              const translated = this.translate.instant(translationKey);
              customErrorMessage = translated !== translationKey ? translated : 'Error de autenticación.';
          } else if (errorCode.startsWith('SAAS_')) {
              // 10/10 IMPROVEMENT: Handle SaaS specific errors (Limits, Features)
              const translationKey = `SAAS.ERRORS.${errorCode}`;
              const translated = this.translate.instant(translationKey);
              customErrorMessage = translated !== translationKey ? translated : 'Límite del plan alcanzado.';
          } else {
             // Avoid exposing raw backend errors if not recognized
             // If we used 'error' as errorCode but it wasn't a known code,
             // we might want to fall back to 'message' for display if safe.
             // But for now, we stick to safe defaults.
             if (error.status >= 500) {
                 customErrorMessage = 'Error interno del servidor.';
             } else {
                 // If errorCode was actually a message (from fallback), show it.
                 // If it was a code like "Bad Request", show it.
                 customErrorMessage = serverError?.message || errorCode;
             }
          }
      } else if (error.status === 401) {
        customErrorMessage = this.translate.instant('LOGIN.ERRORS.AUTH_INVALID_CREDENTIALS');
      } else if (error.status === 403) {
        customErrorMessage =
          'No tienes permiso o la verificación reCAPTCHA ha fallado.';
      } else if (error.status === 404) {
        customErrorMessage = 'El recurso solicitado no fue encontrado.';
      } else if (error.status === 429) {
        customErrorMessage = this.translate.instant('LOGIN.ERRORS.TOO_MANY_ATTEMPTS');
      }
    }

    return throwError(() => ({
      status: error.status,
      message: customErrorMessage,
    }));
  }
}
