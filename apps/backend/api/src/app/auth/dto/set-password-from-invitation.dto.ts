

import { IsNotEmpty, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { IsRecaptchaToken } from './recaptcha-token.decorator';

export class SetPasswordFromInvitationDto {
    @IsString()
    @IsNotEmpty()
    token: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(8, { message: 'validation.set_password_from_invitation.password_must_least_characters_long' })
    @MaxLength(128, { message: 'validation.set_password_from_invitation.password_cannot_exceed_128_characters' })
    @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
        message: 'validation.set_password_from_invitation.password_must_contain_uppercase_letter_lowercase',
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