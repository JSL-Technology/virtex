import { Expose, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class OrganizationResponseDto {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  legalName: string;

  @ApiProperty()
  @Expose()
  taxId: string;
}

export class UserResponseDto {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  email: string;

  @ApiProperty()
  @Expose()
  firstName: string;

  @ApiProperty()
  @Expose()
  lastName: string;

  @ApiProperty()
  @Expose()
  status: string;

  @ApiProperty()
  @Expose()
  organizationId: string;

  @ApiProperty()
  @Expose()
  preferredLanguage: string;

  @ApiProperty()
  @Expose()
  isPhoneVerified: boolean;

  @ApiProperty()
  @Expose()
  isTwoFactorEnabled: boolean;

  @ApiProperty()
  @Expose()
  permissions: string[];

  @ApiProperty()
  @Expose()
  @Type(() => OrganizationResponseDto)
  organization: OrganizationResponseDto;

  @ApiProperty({ required: false })
  @Expose()
  isImpersonating?: boolean;

  @ApiProperty({ required: false })
  @Expose()
  originalUserId?: string;
}
