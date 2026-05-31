import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'La contraseña actual no puede estar vacía.' })
  currentPassword: string;

  @IsString()
  @IsNotEmpty({ message: 'La nueva contraseña no puede estar vacía.' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(50, { message: 'La contraseña no puede tener más de 50 caracteres.' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'La contraseña debe contener al menos una mayúscula, una minúscula y un número o carácter especial.',
  })
  newPassword: string;
}
