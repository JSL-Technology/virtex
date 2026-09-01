import { ALL_PERMISSIONS } from '../shared/permissions';
import { I18nService } from '../i18n/i18n.service';
import { DEFAULT_ROLES } from '../config/roles.config';
import { buildPermissionCatalogue, permissionCatalogueKeys } from './permission-catalogue';

/**
 * The roles screen must never show a machine identifier.
 *
 * It did: the endpoint returned raw slugs and the client split them on the colon, so an
 * administrator saw a group called "Journal_entries" with a checkbox called "view". And the four
 * system roles were provisioned with `description: 'USER.ROLE.ADMINISTRATOR_DESC'` — a key that
 * existed in neither catalogue — which the settings page rendered verbatim to every customer.
 *
 * Both are the same failure: a key that nothing defines, displayed as if it were prose. Neither
 * throws, neither fails a render, and neither can be caught by looking at the code. It is caught
 * here instead.
 */
describe('permission catalogue', () => {
  const i18n = new I18nService();

  it('covers every permission the product defines', () => {
    const catalogued = buildPermissionCatalogue().flatMap((group) =>
      group.permissions.map((permission) => permission.value),
    );
    expect([...catalogued].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('names every group and every action', () => {
    const missing = [...new Set(permissionCatalogueKeys())].filter((key) => !i18n.has(key));
    expect(missing).toEqual([]);
  });

  it('never exposes a slug as a label', () => {
    for (const group of buildPermissionCatalogue()) {
      // The slug is the stored value and must stay stable; the labels are keys, never text.
      expect(group.labelKey).toMatch(/^PERMISSIONS\.GROUPS\./);
      for (const permission of group.permissions) {
        expect(permission.actionKey).toMatch(/^PERMISSIONS\.ACTIONS\./);
        expect(permission.value).toMatch(/^[a-z_]+:[a-z_*]+$/);
      }
    }
  });
});

describe('system roles', () => {
  const i18n = new I18nService();

  it('describes each one with a key the catalogue actually defines', () => {
    // The value in `description` is written into the database at provisioning and read back on
    // the settings screen. A key with no entry becomes visible text.
    const missing = DEFAULT_ROLES.filter((role) => !i18n.has(role.description)).map(
      (role) => `${role.name}: ${role.description}`,
    );
    expect(missing).toEqual([]);
  });
});
