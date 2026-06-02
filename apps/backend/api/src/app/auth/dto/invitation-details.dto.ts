import { IsNotEmpty, IsString } from 'class-validator';

export class InvitationDetailsDto {
    @IsString()
    @IsNotEmpty()
    token!: string;
}
