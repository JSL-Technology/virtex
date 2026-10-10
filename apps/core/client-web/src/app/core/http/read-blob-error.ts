import { HttpErrorResponse } from '@angular/common/http';
import { Observable, from, switchMap, throwError } from 'rxjs';

/**
 * A refused download answers with JSON, but a `responseType: 'blob'` request receives it as a Blob,
 * and `{code, messageKey}` would be invisible to the error handler: the reader would get a generic
 * failure instead of «no tienes permiso» or «demasiadas filas». The body is read back into JSON.
 */
export function readBlobError(error: unknown): Observable<never> {
  if (!(error instanceof HttpErrorResponse) || !(error.error instanceof Blob)) return throwError(() => error);
  return from(error.error.text()).pipe(
    switchMap((text) => {
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // Not JSON: keep the text; the handler falls back to the status.
      }
      return throwError(
        () =>
          new HttpErrorResponse({
            error: body,
            headers: error.headers,
            status: error.status,
            statusText: error.statusText,
            url: error.url ?? undefined,
          }),
      );
    }),
  );
}
