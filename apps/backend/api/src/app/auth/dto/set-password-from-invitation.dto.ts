

import { IsNotEmpty, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { IsRecaptchaToken } from './recaptcha-token.decorator';

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

    /**
     * The bot check for this endpoint.
     *
     * It is public, unauthenticated, and it SETS AUTH COOKIES — the shape of endpoint that most
     * needs one. The client computed a token for it and threw it away: `recaptchaToken$(...)`
     * resolved, and the request was sent without it, so the control the page went to the trouble
     * of obtaining was never applied.
     */
    @IsRecaptchaToken()
    recaptchaToken: string;
}