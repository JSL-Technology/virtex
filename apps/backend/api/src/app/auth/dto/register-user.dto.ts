
import {
    IsPostalCodeValidForCountry,
    IsStateValidForCountry,
    IsSupportedCountry,
    IsTaxIdValidForCountry,
} from '../../common/validators/fiscal-profile.validator';
import {
    IsString,
    IsNotEmpty,
    IsEmail,
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
    @IsString({ message: 'El nombre de la organización debe ser un texto.' })
    @IsNotEmpty({ message: 'El nombre de la organización no puede estar vacío.' })
    @MinLength(2, {
        message: 'El nombre de la organización debe tener al menos 2 caracteres.',
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
    @IsString({ message: 'El país es obligatorio.' })
    @IsNotEmpty({ message: 'El país es obligatorio.' })
    @IsSupportedCountry()
    countryCode: string;

    /**
     * The fiscal identifier, validated arithmetically against the country's algorithm — not a
     * regex. Required: a fiscal product whose tenants have no verifiable tax identity cannot issue
     * a compliant document for any of these markets.
     */
    @ApiProperty({ example: '131-12345-7', description: 'Tax ID (RNC, RFC, EIN, NIT, RUT…)' })
    @IsString({ message: 'El ID Fiscal debe ser un texto.' })
    @IsNotEmpty({ message: 'El ID Fiscal es obligatorio.' })
    @IsTaxIdValidForCountry()
    taxId: string;

    /**
     * Accepted for backwards compatibility only. The server resolves the fiscal region from
     * `countryCode`, so a client cannot select a region that disagrees with the country it
     * validated against.
     */
    @ApiProperty({ example: 'uuid-of-region', description: 'Deprecated: derived from countryCode', required: false })
    @IsUUID('4', { message: 'El ID de la región fiscal no es válido.' })
    @IsOptional()
    fiscalRegionId?: string;

    @ApiProperty({ example: 'John', description: 'User First Name' })
    @IsString({ message: 'El nombre debe ser un texto.' })
    @IsNotEmpty({ message: 'El nombre no puede estar vacío.' })
    firstName: string;

    @ApiProperty({ example: 'Doe', description: 'User Last Name' })
    @IsString({ message: 'El apellido debe ser un texto.' })
    @IsNotEmpty({ message: 'El apellido no puede estar vacío.' })
    lastName: string;

    @ApiProperty({ example: 'john.doe@example.com', description: 'User Email' })
    @IsEmail({}, { message: 'El formato del correo electrónico no es válido.' })
    @IsNotEmpty({ message: 'El correo electrónico no puede estar vacío.' })
    @MaxLength(254, { message: 'El email no puede tener más de 254 caracteres (RFC 5321).' })
    email: string;

    @ApiProperty({ example: 'StrongP@ssw0rd', description: 'User Password' })
    @IsString({ message: 'La contraseña debe ser un texto.' })
    @IsNotEmpty({ message: 'La contraseña no puede estar vacía.' })
    @MinLength(PASSWORD_MIN_LENGTH, { message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.` })
    @MaxLength(PASSWORD_MAX_LENGTH)
    @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
    password: string;

    @ApiProperty({ description: 'Google Recaptcha V3 Token' })
    @IsString()
    @IsNotEmpty({ message: 'El token de reCAPTCHA es obligatorio.' })
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
    @IsString({ message: 'La dirección debe ser un texto.' })
    @IsNotEmpty({ message: 'La dirección fiscal es obligatoria.' })
    @MaxLength(200)
    address: string;

    @ApiProperty({ example: 'Santo Domingo', description: 'City / municipality' })
    @IsString({ message: 'La ciudad debe ser un texto.' })
    @IsNotEmpty({ message: 'La ciudad es obligatoria.' })
    @MaxLength(120)
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

    @ApiProperty({ example: '+18090000000', description: 'User Phone', required: false })
    @IsString()
    @IsOptional()
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
