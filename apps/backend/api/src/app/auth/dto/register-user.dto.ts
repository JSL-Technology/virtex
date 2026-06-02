
import { IsTaxIdValid } from '../../common/validators/tax-id.validator';
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

    // Refactored: Renamed from rnc to taxId and removed specific @IsRNC
    @ApiProperty({ example: '131222222', description: 'Tax ID (RNC, RFC, EIN)', required: false })
    @IsString({ message: 'El ID Fiscal debe ser un texto.' })
    @IsTaxIdValid({ message: 'El ID Fiscal no es válido para la región seleccionada.' })
    @IsOptional()
    taxId?: string;

    @ApiProperty({ example: 'uuid-of-region', description: 'Fiscal Region ID', required: false })
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

    @ApiProperty({ example: 'Av. Winston Churchill', description: 'Fiscal Address', required: false })
    @IsString()
    @IsOptional()
    address?: string;

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
