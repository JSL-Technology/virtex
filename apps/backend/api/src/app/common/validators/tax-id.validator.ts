import { registerDecorator, ValidationOptions, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { Injectable } from '@nestjs/common';
import { LocalizationService } from '../../localization/services/localization.service';

@ValidatorConstraint({ async: true })
@Injectable()
export class TaxIdConstraint implements ValidatorConstraintInterface {
  constructor(private localizationService: LocalizationService) {}

  async validate(taxId: string, args: ValidationArguments) {
    const object = args.object as any;
    const regionId = object.fiscalRegionId;
    if (!taxId || !regionId) return true; // Let other validators handle presence

    const region = await this.localizationService.findById(regionId);
    if (!region) return false;

    const strategy = this.localizationService.getStrategy(region.countryCode);
    return strategy.validateTaxId(taxId);
  }

  defaultMessage(args: ValidationArguments) {
    return 'El ID Fiscal no es válido para la región seleccionada.';
  }
}

export function IsTaxIdValid(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: TaxIdConstraint,
    });
  };
}
