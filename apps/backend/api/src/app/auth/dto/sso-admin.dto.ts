import {
  IsString,
  IsUrl,
  IsOptional,
  IsBoolean,
  IsArray,
  IsUUID,
  MaxLength,
  Matches,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateIdentityProviderDto {
  @ApiProperty({ example: 'Acme Okta' })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'https://acme.okta.com/oauth2/default' })
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  @MaxLength(2048)
  issuerUrl: string;

  @ApiProperty()
  @IsString()
  @MaxLength(512)
  clientId: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  clientSecret: string;

  @ApiPropertyOptional({ type: [String], default: ['openid', 'email', 'profile'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @ApiPropertyOptional({ description: 'Role assigned to JIT-provisioned SSO users.' })
  @IsOptional()
  @IsUUID()
  defaultRoleId?: string;
}

export class UpdateIdentityProviderDto extends PartialType(CreateIdentityProviderDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class AddDomainDto {
  @ApiProperty({ example: 'acme.com' })
  @IsString()
  @MaxLength(253)
  // Basic domain shape: labels separated by dots, no scheme/path.
  @Matches(/^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/, {
    message: 'domain must be a valid bare domain name, e.g. acme.com',
  })
  domain: string;
}
