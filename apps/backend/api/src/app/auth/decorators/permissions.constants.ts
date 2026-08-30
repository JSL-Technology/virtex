/**
 * Metadata key under which a route's permission requirements are stored.
 *
 * It lives in its own module, importing nothing, because both the decorator and the guard need
 * it and the decorator now also needs the guard. Declared in either of those files it would
 * close an import cycle; the previous arrangement dodged that by declaring the literal
 * `'permissions'` twice, in two files, with no link between them — which is exactly how the two
 * decorators drifted into having different enforcement behaviour.
 */
export const PERMISSIONS_KEY = 'permissions';
