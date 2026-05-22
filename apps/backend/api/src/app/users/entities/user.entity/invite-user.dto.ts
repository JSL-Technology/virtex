import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class InviteUserDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsUUID()
  @IsNotEmpty()
  roleId: string;


  @IsString()
  @IsOptional()
  @IsIn(['en', 'es'])
  preferredLanguage?: string;

}