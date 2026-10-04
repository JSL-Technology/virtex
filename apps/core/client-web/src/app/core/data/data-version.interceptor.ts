import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs/operators';
import { DataVersionService } from './data-version.service';

/** Writes that change no business data: the session, preferences, reading a notification. */
const NOT_DATA = [/\/auth\//, /\/me\/workspace/, /\/notifications\//, /\/sessions?\b/, /\/data-transfer\/exports/];

/** Every successful write moves the data version (QA M-06). */
export const dataVersionInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next(req);
  if (NOT_DATA.some((pattern) => pattern.test(req.url))) return next(req);
  const data = inject(DataVersionService);
  return next(req).pipe(
    tap((event) => {
      if (event instanceof HttpResponse && event.ok) data.changed();
    }),
  );
};
