/**
 * De nombre de empresa a identificador de URL.
 *
 * Vive aquí, y no dentro de un servicio, porque lo necesitan tres sitios que no se pueden
 * inyectar entre sí: la migración que rellena la columna, el servicio que crea empresas nuevas y
 * la prueba que comprueba que los dos producen lo mismo. Una segunda copia de esta regla haría
 * que un alta escribiera un slug distinto del que la migración habría escrito para el mismo
 * nombre, y el enlace de una empresa dejaría de resolver según cuándo se creó.
 */

/** Longitud máxima del slug. La columna admite 80; se reserva margen para el sufijo numérico. */
export const SLUG_MAX_LENGTH = 60;

export function slugifyOrganizationName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  // Una empresa cuyo nombre es solo signos de puntuación —existen— necesita algo que sí sea un
  // slug, porque la columna es obligatoria y la ruta no admite un segmento vacío.
  return base || 'empresa';
}

/**
 * El siguiente slug libre para un nombre, dados los que ya están tomados.
 *
 * El sufijo es numérico y visible a propósito: `nortex-comercial-2` se puede dictar, y deja claro
 * que hay otra empresa con el mismo nombre. Un uuid o un hash no cumplen ninguna de las dos cosas.
 */
export function nextFreeSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugifyOrganizationName(name);
  if (!taken.has(base)) return base;

  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** ¿Es esto un slug y no, por ejemplo, un uuid o un intento de recorrido de rutas? */
export function isOrganizationSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80;
}
