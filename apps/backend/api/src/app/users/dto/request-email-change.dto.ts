import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RequestEmailChangeDto {
  @IsEmail()
  @MaxLength(255)
  newEmail: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  currentPassword: string;
}
