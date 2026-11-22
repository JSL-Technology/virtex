import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { UpdateAccountDto } from './update-account.dto';

/**
 * A PATCH carries what it changes and nothing else.
 *
 * `UpdateAccountDto` is `PartialType(CreateAccountDto)`, and `PartialType` copies the parent's
 * property initializers into every instance. With `isPostable = false`, `isActive = true` and
 * `isContraAccount = false` declared on the create DTO, renaming an account through the API asked
 * for it to become a summary account — refused once it had lines, done silently before — to be
 * reactivated, and to stop being a contra account (found by `verify:inflation-adjustment`).
 */
describe('UpdateAccountDto', () => {
  it('leaves out every field the request left out', () => {
    const dto = plainToInstance(UpdateAccountDto, { name: 'Caja chica', reasonForChange: 'Renombrar la cuenta' });
    for (const field of ['isPostable', 'isActive', 'isContraAccount', 'isSystemAccount', 'fxTreatment', 'isInflationAdjustable'] as const) {
      expect(dto[field]).toBeUndefined();
    }
  });
});
