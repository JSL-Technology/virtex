/**
 * Text placed inside an XML element. An identifier the authority returned (a trackId, a ticket, a
 * chave) is interpolated into the status request; escaping it means a value containing `<` or `&`
 * cannot change the request's structure.
 */
export function escapeXmlText(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
