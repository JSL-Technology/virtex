import { IMPLIED_PERMISSIONS, PLATFORM_PERMISSION_PREFIX, hasPermission } from '@virteex/shared/util-auth';
import { ALL_PERMISSIONS, PERMISSIONS } from '../shared/permissions';
import { DEFAULT_ROLES } from '../config/roles.config';
import { RoleEnum } from './enums/role.enum';

/**
 * Changing something includes reading it.
 *
 * The read permissions for the company's configuration and its approval policies came after the
 * permissions to change them. Without the implication, every role that could edit — the system
 * ones and every custom role written before — would meet a 403 opening the page it administers.
 */
describe('implied permissions', () => {
  it('lets whoever may edit the company configuration read it, and not the other way round', () => {
    expect(hasPermission([PERMISSIONS.SETTINGS_EDIT_COMPANY], [PERMISSIONS.SETTINGS_VIEW_COMPANY])).toBe(true);
    expect(hasPermission([PERMISSIONS.SETTINGS_VIEW_COMPANY], [PERMISSIONS.SETTINGS_EDIT_COMPANY])).toBe(false);
  });

  it('lets whoever manages the approval policies read them, and not the other way round', () => {
    expect(hasPermission([PERMISSIONS.WORKFLOWS_MANAGE], [PERMISSIONS.WORKFLOWS_VIEW])).toBe(true);
    expect(hasPermission([PERMISSIONS.WORKFLOWS_VIEW], [PERMISSIONS.WORKFLOWS_MANAGE])).toBe(false);
  });

  it('implies nothing beyond what it declares', () => {
    expect(hasPermission([PERMISSIONS.SETTINGS_EDIT_COMPANY], [PERMISSIONS.WORKFLOWS_VIEW])).toBe(false);
    expect(hasPermission([PERMISSIONS.SETTINGS_VIEW_COMPANY], [PERMISSIONS.SETTINGS_EDIT_BRANDING])).toBe(false);
  });

  it('names only permissions that exist, and never a platform permission', () => {
    const known = new Set<string>(ALL_PERMISSIONS);
    for (const [held, implied] of Object.entries(IMPLIED_PERMISSIONS)) {
      expect(known.has(held)).toBe(true);
      for (const permission of implied) {
        expect(known.has(permission)).toBe(true);
        expect(permission.startsWith(PLATFORM_PERMISSION_PREFIX)).toBe(false);
      }
      expect(held.startsWith(PLATFORM_PERMISSION_PREFIX)).toBe(false);
    }
  });

  it('gives the system accountant read access to the configuration the books depend on', () => {
    const accountant = DEFAULT_ROLES.find((role) => role.name === RoleEnum.ACCOUNTANT);
    expect(accountant?.permissions).toEqual(expect.arrayContaining([PERMISSIONS.SETTINGS_VIEW_COMPANY, PERMISSIONS.WORKFLOWS_VIEW]));
    expect(accountant?.permissions).not.toContain(PERMISSIONS.SETTINGS_EDIT_COMPANY);
  });
});
