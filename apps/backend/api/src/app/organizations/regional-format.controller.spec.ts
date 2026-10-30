import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegionalFormatDto } from '../i18n/dto/regional-format.dto';
import { UpdateProfileDto } from '../users/dto/update-profile.dto';
import { PERMISSIONS } from '../shared/permissions';
import { RegionalFormatController } from './regional-format.controller';

/** How dates and numbers are written for the company: validated, cleaned, and changed only by its editors. */
describe('RegionalFormatController', () => {
  const user = { organizationId: 'org-1' } as never;

  function controller(stored: unknown = null) {
    const settings = { getForOrg: jest.fn(async () => ({ regionalFormat: stored })), update: jest.fn(async () => ({})) };
    return { settings, controller: new RegionalFormatController(settings as never) };
  }

  it('reads the company format cleaned of anything a formatter could not use', async () => {
    const { controller: c } = controller({ numberFormat: 'dot_comma', dateOrder: 'XYZ' });
    await expect(c.get(user)).resolves.toEqual({ numberFormat: 'dot_comma' });
  });

  it('replaces the whole format, and stores no row for «all automatic»', async () => {
    const { controller: c, settings } = controller();
    await c.update(user, plainToInstance(RegionalFormatDto, { dateOrder: 'YMD', timeFormat: null }));
    expect(settings.update).toHaveBeenCalledWith('org-1', { regionalFormat: { dateOrder: 'YMD' } });
    await c.update(user, plainToInstance(RegionalFormatDto, {}));
    expect(settings.update).toHaveBeenLastCalledWith('org-1', { regionalFormat: null });
  });

  it('is changed with settings:edit_company only', () => {
    const permissions = Reflect.getMetadataKeys(RegionalFormatController.prototype.update)
      .map((key) => Reflect.getMetadata(key, RegionalFormatController.prototype.update))
      .flat();
    expect(JSON.stringify(permissions)).toContain(PERMISSIONS.SETTINGS_EDIT_COMPANY);
  });

  it.each([
    [{ numberFormat: 'semicolon' }],
    [{ dateOrder: 'dmy' }],
    [{ firstDayOfWeek: 3 }],
    [{ dateSeparator: '|' }],
  ])('refuses a value outside the catalogue: %j', async (body) => {
    expect(await validate(plainToInstance(RegionalFormatDto, body))).not.toHaveLength(0);
  });

  it('accepts «automatic» (null) for every field, and a person’s preference through the profile', async () => {
    expect(await validate(plainToInstance(RegionalFormatDto, { dateOrder: null, numberFormat: null, firstDayOfWeek: 1 }))).toHaveLength(0);
    const profile = plainToInstance(UpdateProfileDto, { regionalFormat: { numberFormat: 'semicolon' } });
    expect(await validate(profile)).not.toHaveLength(0);
    expect(await validate(plainToInstance(UpdateProfileDto, { regionalFormat: { timeFormat: 'h12' } }))).toHaveLength(0);
  });
});
