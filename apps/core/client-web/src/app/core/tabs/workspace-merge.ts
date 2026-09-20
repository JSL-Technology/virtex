import { TabModel } from './tab.model';

/**
 * Une dos versiones del mismo espacio de trabajo.
 *
 * ## Por qué hay que unir y no elegir
 *
 * El espacio de trabajo vive en dos sitios: este navegador y el servidor. Dos equipos abiertos a
 * la vez escriben el mismo registro, así que «el último gana» significa que el portátil cierra en
 * silencio las pestañas que acabas de abrir en el de la oficina. Nadie se enteraría hasta echar en
 * falta un documento, y entonces el producto habría perdido trabajo sin decirlo.
 *
 * Unir es la respuesta honesta: las pestañas de los dos equipos son trabajo real de la misma
 * persona, y ninguna de las dos listas es más correcta que la otra.
 *
 * ## Las reglas, y por qué
 *
 * - **Identidad**: `entityKey` si la hay, y si no la ruta. Es la misma regla con la que el
 *   producto ya deduplica pestañas al abrirlas, así que abrir la factura 128 en dos equipos no
 *   produce dos pestañas de la factura 128.
 * - **Ante duplicado gana la más reciente** por `lastActivatedAt`: la copia que se tocó después
 *   lleva el scroll y el estado de vista más útiles.
 * - **Las sucias ganan siempre**, sea cual sea la fecha. Una pestaña con cambios sin guardar es
 *   trabajo que no está en ninguna otra parte; descartarla por ser más antigua sería tirar
 *   exactamente lo único que no se puede recuperar.
 * - **El foco es de esta ventana**: la pestaña activa que gana es la local. Adoptar la del otro
 *   equipo movería la vista de alguien que está mirando otra cosa.
 * - **El orden es el local, y lo que llega nuevo se añade al final**: reordenar las pestañas de
 *   alguien mientras trabaja es desorientarlo por un beneficio que no existe.
 */
export function mergeWorkspaces(
  local: TabModel[],
  remote: TabModel[],
): TabModel[] {
  const identity = (tab: TabModel): string => tab.entityKey ?? tab.route;
  const merged = new Map<string, TabModel>();

  for (const tab of local) merged.set(identity(tab), tab);

  for (const tab of remote) {
    const key = identity(tab);
    const mine = merged.get(key);
    if (!mine) {
      merged.set(key, tab);
      continue;
    }
    if (mine.isDirty) continue; // lo sucio local no se reemplaza
    if (tab.isDirty) {
      merged.set(key, tab);
      continue;
    }
    if (tab.lastActivatedAt.getTime() > mine.lastActivatedAt.getTime()) {
      merged.set(key, tab);
    }
  }

  // El orden local primero, y detrás lo que solo existía en el servidor.
  const localKeys = new Set(local.map(identity));
  const ordered = local.map((tab) => merged.get(identity(tab)) as TabModel);
  for (const [key, tab] of merged) {
    if (!localKeys.has(key)) ordered.push(tab);
  }
  return ordered;
}
