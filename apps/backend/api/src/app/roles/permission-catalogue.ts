import { ALL_PERMISSIONS } from '../shared/permissions';

/**
 * The permission list, as something a person can read.
 *
 * ## What it replaces
 *
 * `GET /roles/available-permissions` returned the raw slugs — `journal_entries:view`,
 * `coa:merge`, `users:manage_status` — and the roles screen built its labels by splitting on the
 * colon and capitalising the first letter. An administrator deciding who may reverse a journal
 * entry was shown a group called **"Journal_entries"** with a checkbox called **"view"**. In
 * English, in a Spanish product, on the screen that governs access to the ledger.
 *
 * ## Why group and action are separate keys
 *
 * Sixty-six permissions across twenty groups and thirty-one actions. Naming each permission
 * individually would be sixty-six strings that mostly repeat the word "view"; naming the group
 * and the action separately is fifty-one, and every new permission built from an existing pair
 * is then already translated. "Facturas · Ver" and "Invoices · View" both come out right, and a
 * new `invoices:export` needs one word, not a sentence.
 *
 * The slug stays the identifier and is never shown: it is the value the API stores and compares,
 * and it must not change when somebody rewords a label.
 */

export interface PermissionCatalogueEntry {
  /** The stored value. Unchanged, and never rendered. */
  value: string;
  /** Catalogue key for the action ("Ver", "Crear", "Anular"). */
  actionKey: string;
}

export interface PermissionCatalogueGroup {
  /** Slug prefix, e.g. `journal_entries`. Stable; used as a React/Angular track key. */
  key: string;
  /** Catalogue key for the group name ("Asientos contables"). */
  labelKey: string;
  permissions: PermissionCatalogueEntry[];
}

/** `journal_entries` → `PERMISSIONS.GROUPS.JOURNAL_ENTRIES`. */
export function groupLabelKey(group: string): string {
  return `PERMISSIONS.GROUPS.${group.toUpperCase()}`;
}

/** `manage_status` → `PERMISSIONS.ACTIONS.MANAGE_STATUS`. */
export function actionLabelKey(action: string): string {
  return `PERMISSIONS.ACTIONS.${action.toUpperCase()}`;
}

/**
 * Build the catalogue from the permission constants.
 *
 * Derived rather than hand-maintained: a permission added to `PERMISSIONS` appears here without
 * anybody remembering to add it, which is what keeps the roles screen from silently omitting a
 * capability. A missing translation is caught by `permission-catalogue.spec.ts`, which asserts
 * that every derived key exists.
 */
export function buildPermissionCatalogue(): PermissionCatalogueGroup[] {
  const groups = new Map<string, PermissionCatalogueEntry[]>();

  for (const value of ALL_PERMISSIONS) {
    const [group, action] = value.split(':');
    if (!group || !action) continue;
    const entries = groups.get(group) ?? [];
    entries.push({ value, actionKey: actionLabelKey(action) });
    groups.set(group, entries);
  }

  return [...groups.entries()].map(([key, permissions]) => ({
    key,
    labelKey: groupLabelKey(key),
    permissions,
  }));
}

/** Every key the catalogue references, for the spec that checks they all exist. */
export function permissionCatalogueKeys(): string[] {
  return buildPermissionCatalogue().flatMap((group) => [
    group.labelKey,
    ...group.permissions.map((permission) => permission.actionKey),
  ]);
}
