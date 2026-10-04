import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CountryConfig, FiscalFieldSpec, TaxpayerKind } from '../../../core/services/country.service';

/**
 * The company half of a signup: its fiscal configuration, what it does, and the plan it pays for.
 *
 * Shared by the public signup and by «Add a company» for someone already signed in, so a company
 * is described — and validated — the same way whichever door it comes in by. The steps that render
 * these groups (`StepConfiguration`, `StepBusiness`, `StepPlan`) take a group as input and were
 * already independent of the page around them; what was not was this logic, which lived inside the
 * signup page and would have been copied.
 */

export function buildConfigurationGroup(fb: FormBuilder): FormGroup {
  return fb.group({
    country: ['DO', [Validators.required]],
    // Company or natural person. Nine of the nineteen markets issue a different fiscal identifier
    // to each, or encode the distinction inside one, and it also selects which régimen fiscal
    // options the SAT catalogue offers — so it has to be answered before the tax id can be
    // validated at all.
    taxpayerKind: ['company', [Validators.required]],
    taxId: ['', [Validators.required]],
    fiscalRegionId: [null],
    currency: ['DOP', [Validators.required]],
    // Country-specific fiscal answers, added and removed as the country or the taxpayer kind
    // changes. Declared as an empty group rather than a fixed set, because which controls exist is
    // a property of the country.
    fiscalProfile: fb.group({}),
    // The fiscal address. Structured, because every electronic-invoicing regime in these markets
    // stamps these fields individually.
    address: ['', [Validators.required]],
    city: ['', [Validators.required]],
    state: ['', [Validators.required]],
    postalCode: [''],
  });
}

export function buildPlanGroup(fb: FormBuilder): FormGroup {
  return fb.group({
    selectedPlanId: ['starter', [Validators.required]],
    // Monthly unless the customer picks otherwise, and only offered when every plan has an annual
    // Stripe Price behind it — the server refuses a period it cannot charge.
    billingPeriod: ['monthly', [Validators.required]],
    agreeToTerms: [false, [Validators.requiredTrue]],
  });
}

/**
 * Re-shape the configuration for a country.
 *
 * There is no fallback tax-id pattern: the country's own pattern applies, and when no country is
 * loaded the fields carry only `required`, which cannot pass silently.
 */
export function applyCountryConfig(configuration: FormGroup, config: CountryConfig, fb: FormBuilder): void {
  // The pattern follows the taxpayer kind, because several countries issue a different document to
  // a natural person: an EIN pattern applied to an SSN rejects a valid value.
  syncTaxIdValidator(configuration, config);

  // The postal code is required only where the country requires it — United States sales tax is
  // destination-based and cannot be computed without a ZIP, whereas most of Latin America does not
  // use postal codes on fiscal documents at all.
  const postalCodeControl = configuration.get('postalCode');
  const postalValidators = config.address.postalCodeRequired ? [Validators.required] : [];
  if (config.address.postalCodePattern) {
    postalValidators.push(Validators.pattern(config.address.postalCodePattern));
  }
  postalCodeControl?.setValidators(postalValidators);
  postalCodeControl?.updateValueAndValidity({ emitEvent: false });

  // Switching country invalidates a division code from the previous country's catalogue.
  const stateControl = configuration.get('state');
  if (config.address.divisions && stateControl?.value) {
    const stillValid = config.address.divisions.some((d) => d.code === stateControl.value);
    if (!stillValid) stateControl.setValue('', { emitEvent: false });
  }

  syncFiscalFields(configuration, config, fb);

  configuration.get('currency')?.setValue(config.currency, { emitEvent: false });
  configuration.get('fiscalRegionId')?.setValue(config.fiscalRegionId ?? null, { emitEvent: false });
  configuration.get('country')?.setValue(config.countryCode, { emitEvent: false });
}

/**
 * Rebuild the country's extra fiscal controls.
 *
 * Which fields exist depends on the country AND on whether the taxpayer is a company or a natural
 * person — a Mexican persona moral picks from a different `RegimenFiscal` list than a persona
 * física. The server publishes the specs and this rebuilds the group from them, so opening a
 * market changes one list on the backend.
 *
 * Existing answers are carried over when the field survives the change, so switching taxpayer kind
 * does not silently wipe an address the user already typed.
 */
export function syncFiscalFields(
  configuration: FormGroup,
  config: { fiscalFields?: FiscalFieldSpec[] } | null,
  fb: FormBuilder,
): void {
  const group = configuration.get('fiscalProfile') as FormGroup | null;
  if (!group) return;

  const kind = configuration.get('taxpayerKind')?.value as TaxpayerKind | undefined;
  const specs = (config?.fiscalFields ?? []).filter(
    (field) => !field.appliesTo || !kind || field.appliesTo.includes(kind),
  );
  const wanted = new Set(specs.map((field) => field.key));

  for (const existing of Object.keys(group.controls)) {
    if (!wanted.has(existing)) group.removeControl(existing, { emitEvent: false });
  }

  for (const field of specs) {
    const validators = field.required ? [Validators.required] : [];
    if (field.type === 'text' && field.pattern) {
      validators.push(Validators.pattern(field.pattern));
    }
    const current = group.get(field.key);
    if (current) {
      // A select whose option list no longer contains the chosen code must not keep it.
      if (field.type === 'select' && current.value) {
        const allowed = (field.options ?? []).filter(
          (option) => !option.appliesTo || !kind || option.appliesTo.includes(kind),
        );
        if (field.multiple) {
          // Drop only the entries that are no longer offered, keeping the rest of the choice.
          const kept = (current.value as string[]).filter((code) =>
            allowed.some((option) => option.code === code),
          );
          if (kept.length !== (current.value as string[]).length) {
            current.setValue(kept, { emitEvent: false });
          }
        } else if (!allowed.some((option) => option.code === current.value)) {
          current.setValue('', { emitEvent: false });
        }
      }
      current.setValidators(validators);
      current.updateValueAndValidity({ emitEvent: false });
    } else {
      // A multi-valued field holds an array from the start: initialising it with `''` and letting
      // the template push strings in produces a control whose emptiness check
      // (`Validators.required`) passes for `['']`.
      group.addControl(field.key, fb.control(field.multiple ? [] : '', validators), { emitEvent: false });
    }
  }
}

/**
 * The client-side shape for the tax id, for the country AND the taxpayer kind.
 *
 * A country that issues a separate document to natural persons publishes it as
 * `individualDocument`. Validating a sole proprietor's SSN against the EIN pattern rejected a value
 * the server accepts.
 */
export function syncTaxIdValidator(
  configuration: FormGroup,
  config: { taxIdPattern: string; individualDocument?: { pattern: string } | null },
): void {
  const kind = configuration.get('taxpayerKind')?.value as TaxpayerKind | undefined;
  const pattern =
    kind === 'individual' && config.individualDocument ? config.individualDocument.pattern : config.taxIdPattern;
  const control = configuration.get('taxId');
  control?.setValidators([Validators.required, Validators.pattern(pattern)]);
  control?.updateValueAndValidity({ emitEvent: false });
}

/** After the taxpayer kind changes: its fields and its identifier scheme change with it. */
export function onTaxpayerKindChanged(configuration: FormGroup, config: CountryConfig | null, fb: FormBuilder): void {
  syncFiscalFields(configuration, config, fb);
  if (config) syncTaxIdValidator(configuration, config);
  // The tax id was validated against the other scheme; re-checking it now tells the user
  // immediately rather than after they reach the plan step.
  configuration.get('taxId')?.updateValueAndValidity();
}

/** The company fields of a signup payload, from the three groups. */
export function companyPayload(value: {
  configuration: Record<string, unknown> & { fiscalProfile?: Record<string, string> };
  business: Record<string, unknown>;
  plan: Record<string, unknown>;
}) {
  const configuration = value.configuration as {
    country: string;
    taxpayerKind: TaxpayerKind;
    taxId: string;
    fiscalProfile?: Record<string, string>;
    address: string;
    city: string;
    state: string;
    postalCode?: string;
  };
  const business = value.business as { companyName: string; industry: string; companySize?: string };
  const plan = value.plan as { selectedPlanId: string; billingPeriod: string };
  return {
    organizationName: business.companyName,
    // The country is the authoritative fiscal field. The server resolves the region from it and
    // ignores any region id the client supplies.
    countryCode: configuration.country,
    taxpayerKind: configuration.taxpayerKind,
    taxId: configuration.taxId,
    fiscalProfile: configuration.fiscalProfile ?? {},
    industry: business.industry,
    companySize: business.companySize || undefined,
    address: configuration.address,
    city: configuration.city,
    state: configuration.state,
    postalCode: configuration.postalCode || undefined,
    planId: plan.selectedPlanId,
    billingPeriod: plan.billingPeriod,
  };
}
