

import { IsNotEmpty, IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class SetPasswordFromInvitationDto {
    @IsString()
    @IsNotEmpty()
    token: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(8, { message: 'VALIDATION.SET_PASSWORD_FROM_INVITATION.CONTRASENA_DEBE_TENER_AL_MENOS_8_CARACTERES' })
    @MaxLength(128, { message: 'VALIDATION.SET_PASSWORD_FROM_INVITATION.CONTRASENA_NO_PUEDE_SUPERAR_128_CARACTERES' })
    @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
        message: 'VALIDATION.SET_PASSWORD_FROM_INVITATION.CONTRASENA_DEBE_CONTENER_MAYUSCULA_MINUSCULA_NUMERO_SIMBOLO',
    })
    password: string;
}