import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RequestEmailChangeDto {
  @IsEmail()
  @MaxLength(254)
  newEmail!: string;

  @IsString()
  @IsNotEmpty()
  currentPassword!: string;
}

export class ConfirmEmailChangeDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
