import { IsBoolean } from 'class-validator';

/** `Boolean(isActive)` on a raw body field read the string "false" as true; a boolean is required. */
export class SetNcfSequenceActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
