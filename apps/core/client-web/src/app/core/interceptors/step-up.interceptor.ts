
import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpEvent } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable } from 'rxjs';
import { StepUpService } from '../services/step-up.service';

export const stepUpInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const stepUpService = inject(StepUpService);
  const token = stepUpService.consumeToken();

  if (token) {
    req = req.clone({
      setHeaders: {
        'x-step-up-token': token
      }
    });
  }

  return next(req);
};
