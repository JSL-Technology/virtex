import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '../entities/user.entity/user.entity';

// H-08 FIX: Explicit DTO with runtime IsEnum validation — TypeScript types are erased at runtime
// so @Body('status') without a DTO accepts any string (OWASP Input Validation Cheat Sheet; CWE-20).
export class UpdateUserStatusDto {
  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  status!: UserStatus;
}
