import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs/operators';
import { NOTICES_HEADER, parseRequestNotices } from '@virtex/shared/types';
import { NotificationService } from '../services/notification';

/**
 * Shows what the API said about a request that succeeded with a caveat.
 *
 * A document converted at the market rate because the company had no official one on file was
 * posted with a line in the server's log and nothing on the screen of the person who posted it
 * (FINB-06). The API now sends such caveats in the `Virtex-Notices` header of the response
 * (`request-notices.contract.ts`); this shows each as a warning, rendered from the catalogue in the
 * reader's language like every error is, so no screen has to remember to look for them.
 */
export const noticesInterceptor: HttpInterceptorFn = (request, next) => {
  const notifications = inject(NotificationService);
  return next(request).pipe(
    tap((event) => {
      if (!(event instanceof HttpResponse)) return;
      for (const notice of parseRequestNotices(event.headers.get(NOTICES_HEADER))) {
        notifications.showWarning(notice.messageKey, notice.messageParams);
      }
    }),
  );
};
