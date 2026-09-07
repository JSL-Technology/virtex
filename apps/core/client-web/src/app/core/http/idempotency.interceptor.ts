import { HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Carries an `Idempotency-Key` on every state-changing request.
 *
 * The backend refuses a business transition without one, and refusing is the right default there:
 * issuing an invoice posts a journal entry, consumes a fiscal sequence and moves stock, so a
 * transition the client cannot safely retry is one that will eventually be executed twice.
 *
 * ## What this interceptor does and does not buy
 *
 * It guarantees the header EXISTS. That is all, and it is deliberately all: a key minted here is
 * fresh per HTTP call, so two clicks produce two keys and the server sees two distinct requests.
 * Protection against the double click has to come from the caller, because only the caller knows
 * that two clicks were one intention — see `IdempotencyKeyService`, which mints a key per user
 * action and holds it across retries.
 *
 * So the layering is: the service names the intention, this interceptor covers everything else so
 * no request can arrive without a key and be refused for a reason the user cannot act on. A caller
 * that already set the header keeps it; this never overwrites one.
 */
export function idempotencyInterceptor(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const mutating = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH';

  if (!mutating || req.headers.has('Idempotency-Key')) {
    return next(req);
  }

  return next(req.clone({ setHeaders: { 'Idempotency-Key': crypto.randomUUID() } }));
}
