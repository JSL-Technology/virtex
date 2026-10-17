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
 * - **Un `id` es una ventana, y una ventana está una sola vez**. La vista previa se reutiliza: la
 *   misma ventana pasa de un registro a otro conservando su `id`. La copia del servidor guardaba
 *   el registro anterior, su identidad ya no coincidía con la local, y la unión la añadía como
 *   otra pestaña con el MISMO `id` — una más en cada arranque (QA: catorce copias). Buscar esa
 *   ventana por `id` devolvía la primera, así que abrir una ejecución enseñaba el diseñador que la
 *   vista previa mostraba antes. Lo que dice la ventana local es lo que la ventana muestra ahora.
 */
/** The identity a tab is merged by: its record when it has one, else its route. */
export const tabIdentity = (tab: Pick<TabModel, 'entityKey' | 'route'>): string => tab.entityKey ?? tab.route;

/**
 * Tabs the person closed, by identity, with when (epoch ms).
 *
 * A union alone cannot tell «never had this tab» from «closed it»: a tab closed here and reloaded
 * before the server heard about it came back from the server's older copy, and so did every tab
 * closed on one device while another still listed it. A closure newer than the remote tab's last
 * use wins; reopening the tab later is newer still, so it is not blocked forever.
 */
export type ClosedTabs = ReadonlyMap<string, number>;

export function mergeWorkspaces(
  local: TabModel[],
  remote: TabModel[],
  closed: ClosedTabs = new Map(),
): TabModel[] {
  const identity = tabIdentity;
  const merged = new Map<string, TabModel>();
  const localIds = new Map(local.map((tab) => [tab.id, identity(tab)]));

  for (const tab of local) merged.set(identity(tab), tab);

  for (const tab of remote) {
    const key = identity(tab);
    // The same window showing something else here: the remote copy is what it used to show.
    const sameWindow = localIds.get(tab.id);
    if (sameWindow !== undefined && sameWindow !== key) continue;
    const mine = merged.get(key);
    const closedAt = closed.get(key);
    if (!mine && closedAt !== undefined && closedAt >= tab.lastActivatedAt.getTime()) continue;
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
  return uniqueTabIds(ordered);
}

/**
 * One tab per `id`, in the given order. Where a window appears more than once — a workspace saved
 * before the rule above existed — the copy used last is the one kept, at the place of the first.
 */
export function uniqueTabIds(tabs: TabModel[]): TabModel[] {
  const latest = new Map<string, TabModel>();
  for (const tab of tabs) {
    const seen = latest.get(tab.id);
    if (!seen || tab.lastActivatedAt.getTime() > seen.lastActivatedAt.getTime()) latest.set(tab.id, tab);
  }
  const placed = new Set<string>();
  const out: TabModel[] = [];
  for (const tab of tabs) {
    if (placed.has(tab.id)) continue;
    placed.add(tab.id);
    out.push(latest.get(tab.id) as TabModel);
  }
  return out;
}
