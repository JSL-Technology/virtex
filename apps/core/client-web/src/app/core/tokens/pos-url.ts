import { environment } from '../../../environments/environment';

/**
 * Where the point-of-sale application lives.
 *
 * The till is its own application (`apps/pos`), deployed apart from the ERP but on the same origin
 * (under `/pos/` by default), so the session cookies are shared and a person signed in here is
 * signed in there. In development it is its own dev server on :4300.
 */
export const POS_URL: string = environment.posUrl || '/pos/';
