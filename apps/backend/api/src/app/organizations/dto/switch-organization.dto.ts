import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SwitchOrganizationDto {
  @ApiProperty({ description: 'The organization to switch into. Must be one the user belongs to.' })
  @IsUUID('4', { message: 'VALIDATION.SWITCH_ORGANIZATION.IDENTIFICADOR_ORGANIZACION_NO_VALIDO' })
  organizationId: string;
}
