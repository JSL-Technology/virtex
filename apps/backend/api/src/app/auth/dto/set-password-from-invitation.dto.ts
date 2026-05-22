

import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

export class SetPasswordFromInvitationDto {
    @IsString()
    @IsNotEmpty()
    token: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
    @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
        message: 'La contraseña debe contener mayúscula, minúscula y un número o símbolo.',
    })
    password: string;
}