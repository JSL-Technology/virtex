import { IsRecaptchaToken } from './recaptcha-token.decorator';
import {
    IsFiscalProfileValidForCountry,
    IsPostalCodeValidForCountry,
    IsStateValidForCountry,
    IsSupportedCountry,
    IsTaxIdValidForCountry,
} from '../../common/validators/fiscal-profile.validator';
import { TaxpayerKind } from '../../localization/fiscal/tax-id-validators';
import { IsE164PhoneNumber } from '../../common/validators/is-e164-phone-number.validator';
import {
    IsString,
    IsNotEmpty,
    IsEmail,
    IsEnum,
    MinLength,
    MaxLength,
    Matches,
    IsOptional,
    IsUUID,
} from 'class-validator';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_POLICY_REGEX, PASSWORD_POLICY_MESSAGE } from './password-policy';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterUserDto {

    @ApiProperty({ example: 'Acme Corp', description: 'Organization Legal Name' })
    // Presence is declared BEFORE shape on every field in this DTO. With `stopAtFirstError` the
    // first failing constraint is the one the customer sees, and "está vacío" explains an empty
    // field where "debe ser un texto" does not.
    @IsNotEmpty({ message: 'VALIDATION.REGISTER_USER.NOMBRE_ORGANIZACION_NO_PUEDE_ESTAR_VACIO' })
    @IsString({ message: 'VALIDATION.REGISTER_USER.NOMBRE_ORGANIZACION_DEBE_TEXTO' })
    @MinLength(2, {
        message: 'VALIDATION.REGISTER_USER.NOMBRE_ORGANIZACION_DEBE_TENER_AL_MENOS_2_CARACTERES',
    })
    organizationName: string;

    /**
     * The market the tenant operates in, ISO 3166-1 alpha-2.
     *
     * This is now the authoritative field and it is required. The payload used to carry only an
     * optional `fiscalRegionId`, and everything downstream — tax id validation, the chart of
     * accounts, the default taxes, the country registration strategy — was conditional on it
     * being present. Omitting it produced a tenant with no fiscal identity and a success message.
     */
    @ApiProperty({ example: 'DO', description: 'ISO 3166-1 alpha-2 country code' })
    @IsString({ message: 'VALIDATION.REGISTER_USER.PAIS_OBLIGATORIO' })
    @IsNotEmpty({ message: 'VALIDATION.REGISTER_USER.PAIS_OBLIGATORIO' })
    @IsSupportedCountry()
    countryCode: string;

    /**
     * Whether the tenant is a legal entity or a natural person.
     *
     * Declared BEFORE `taxId` on purpose: class-validator evaluates in declaration order and the
     * tax-id constraint reads this off the same object, so a payload whose kind fails validation
     * should not also produce a confusing tax-id error derived from it.
     *
     * Nine of the nineteen markets issue a different identifier to each kind, or encode the
     * distinction inside one — the United States an EIN versus an SSN/ITIN, Brazil a CNPJ versus a
     * CPF, Mexico a 12- versus a 13-character RFC. It also selects which `regimenFiscal` options
     * the SAT catalogue offers, so it has to be answered before the fiscal profile can be.
     */
    @ApiProperty({ enum: TaxpayerKind, example: TaxpayerKind.COMPANY, description: 'Legal entity or natural person' })
    @IsEnum(TaxpayerKind, { message: 'VALIDATION.REGISTER_USER.INDICA_SI_CONTRIBUYENTE_EMPRESA_PERSONA_FISICA' })
    taxpayerKind: TaxpayerKind;

    /**
     * The fiscal identifier, validated arithmetically against the country's algorithm — not a
     * regex — and against the scheme that applies to `taxpayerKind`. Required: a fiscal product
     * whose tenants have no verifiable tax identity cannot issue a compliant document for any of
     * these markets.
     */
    @ApiProperty({ example: '131-12345-7', description: 'Tax ID (RNC, RFC, EIN, NIT, RUT…)' })
    @IsNotEmpty({ message: 'VALIDATION.REGISTER_USER.ID_FISCAL_OBLIGATORIO' })
    @IsString({ message: 'VALIDATION.REGISTER_USER.ID_FISCAL_DEBE_TEXTO' })
    @IsTaxIdValidForCountry()
    taxId: string;

    /**
     * The country's remaining fiscal data, keyed by the `FiscalFieldSpec.key` it answers.
     *
     * A free-form object rather than nineteen optional properties, because which keys exist is a
     * property of the country and the taxpayer kind. The constraint rejects unknown keys, so this
     * is not a hole: nothing the country did not ask for reaches the database.
     *
     * Deliberately NOT `@IsOptional()` and NOT `@IsObject()`. `@IsOptional()` short-circuits every
     * other constraint when the value is absent, and "absent" is precisely the case this has to
     * catch: a Mexican signup that simply omits the object must fail on the missing
     * `regimenFiscal`, not pass because the whole field was left out. The constraint decides per
     * country whether an empty object is acceptable, and rejects a non-object itself.
     */
    @ApiProperty({
        required: false,
        example: { regimenFiscal: '601' },
        description: 'Country-specific fiscal data (régimen fiscal, condición IVA, CRT, giro…)',
    })
    @IsFiscalProfileValidForCountry()
    fiscalProfile?: Record<string, string>;

    /**
     * Accepted for backwards compatibility only. The server resolves the fiscal region from
     * `countryCode`, so a client cannot select a region that disagrees with the country it
     * validated against.
     */
    @ApiProperty({ example: 'uuid-of-region', description: 'Deprecated: derived from countryCode', required: false })
    @IsUUID('4', { message: 'VALIDATION.REGISTER_USER.ID_REGION_FISCAL_NO_VALIDO' })
    @IsOptional()
    fiscalRegionId?: string;

    @ApiProperty({ example: 'John', description: 'User First Name' })
    @IsNotEmpty({ message: 'VALIDATION.REGISTER_USER.NOMBRE_NO_PUEDE_ESTAR_VACIO' })
    @IsString({ message: 'VALIDATION.REGISTER_USER.NOMBRE_DEBE_TEXTO' })
    firstName: string;

    @ApiProperty({ example: 'Doe', description: 'User Last Name' })
    @IsNotEmpty({ message: 'VALIDATION.REGISTER_USER.APELLIDO_NO_PUEDE_ESTAR_VACIO' })
    @IsString({ message: 'VALIDATION.REGISTER_USER.APELLIDO_DEBE_TEXTO' })
    lastName: string;

    @ApiProperty({ example: 'john.doe@example.com', description: 'User Email' })
    @IsEmail({}, { message: 'VALIDATION.REGISTER_USER.FORMATO_CORREO_ELECTRONICO_NO_VALIDO' })
    @IsNotEmpty({ message: 'VALIDATION.REGISTER_USER.CORREO_ELECTRONICO_NO_PUEDE_ESTAR_VACIO' })
    @MaxLength(254, { message: 'VALIDATION.REGISTER_USER.EMAIL_NO_PUEDE_TENER_MAS_254_CARACTERES_RFC' })
    email: string;

    @ApiProperty({ example: 'StrongP@ssw0rd', description: 'User Password' })
    @IsNotEmpty({ message: 'VALIDATION.REGISTER_USER.CONTRASENA_NO_PUEDE_ESTAR_VACIA' })
    @IsString({ message: 'VALIDATION.REGISTER_USER.CONTRASENA_DEBE_TEXTO' })
    @MinLength(PASSWORD_MIN_LENGTH, { message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.` })
    @MaxLength(PASSWORD_MAX_LENGTH, { message: `La contraseña no puede tener más de ${PASSWORD_MAX_LENGTH} caracteres.` })
    @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
    password: string;

    @IsRecaptchaToken()
    recaptchaToken: string;

    // Added fields for provisioning
    @ApiProperty({ example: 'technology', description: 'Industry', required: false })
    @IsString()
    @IsOptional()
    industry?: string;

    @ApiProperty({ example: '1-10', description: 'Company Size', required: false })
    @IsString()
    @IsOptional()
    companySize?: string;

    /**
     * The fiscal address, structured.
     *
     * A single free-text line cannot support any of the electronic-invoicing regimes these markets
     * mandate: CFDI 4.0 stamps a `LugarExpedicion` postal code, DIAN and SII require a coded
     * municipality, and United States sales tax is destination-based and undeterminable without
     * state and ZIP. Collecting one line means re-collecting all of it before invoicing can work.
     */
    @ApiProperty({ example: 'Av. Winston Churchill 1099', description: 'Fiscal street address' })
    @IsNotEmpty({ message: 'VALIDATION.REGISTER_USER.DIRECCION_FISCAL_OBLIGATORIA' })
    @IsString({ message: 'VALIDATION.REGISTER_USER.DIRECCION_DEBE_TEXTO' })
    @MaxLength(200, { message: 'VALIDATION.REGISTER_USER.DIRECCION_NO_PUEDE_TENER_MAS_200_CARACTERES' })
    address: string;

    @ApiProperty({ example: 'Santo Domingo', description: 'City / municipality' })
    @IsNotEmpty({ message: 'VALIDATION.REGISTER_USER.CIUDAD_OBLIGATORIA' })
    @IsString({ message: 'VALIDATION.REGISTER_USER.CIUDAD_DEBE_TEXTO' })
    @MaxLength(120, { message: 'VALIDATION.REGISTER_USER.CIUDAD_NO_PUEDE_TENER_MAS_120_CARACTERES' })
    city: string;

    @ApiProperty({ example: '32', description: 'First-level administrative division code or name' })
    @IsStateValidForCountry()
    state: string;

    /**
     * Deliberately NOT `@IsOptional()`. That decorator short-circuits every other constraint when
     * the value is absent, which is exactly the case this field has to catch: the United States
     * requires a ZIP because its sales tax is destination-based, so "missing" is the failure, not
     * the exemption. The constraint itself decides per country whether an empty value is allowed.
     */
    @ApiProperty({ example: '10101', description: 'Postal code, where the country requires one', required: false })
    @IsPostalCodeValidForCountry()
    postalCode?: string;

    /**
     * Optional, and validated as E.164 when present.
     *
     * It was `@IsString() @IsOptional()` with no format check, while `UpdateProfileDto.phone` —
     * the same datum on the same person — required E.164. The signup form meanwhile marked it
     * required and gated the whole wizard on an SMS verification, so the three layers disagreed
     * three ways. Optional is the right answer for a B2B ERP: mandatory SMS at signup is real
     * friction for corporate buyers and an SMS-pumping surface, and the second factor is enrolled
     * later from the security settings by whoever wants one.
     */
    @ApiProperty({ example: '+18090000000', description: 'User phone in E.164 format', required: false })
    @IsOptional()
    @IsString()
    @IsE164PhoneNumber({ message: 'VALIDATION.REGISTER_USER.TELEFONO_DEBE_ESTAR_FORMATO_INTERNACIONAL_E_164_POR' })
    phone?: string;

    @ApiProperty({ example: '123456', description: 'Email Verification Code', required: false })
    @IsString()
    @IsOptional()
    emailVerificationCode?: string;

    @ApiProperty({ example: '123456', description: 'Phone Verification Code', required: false })
    @IsString()
    @IsOptional()
    phoneVerificationCode?: string;

    @ApiProperty({ description: 'Honeypot field (should be empty)', required: false })
    @IsString()
    @IsOptional()
    fax?: string;
}
