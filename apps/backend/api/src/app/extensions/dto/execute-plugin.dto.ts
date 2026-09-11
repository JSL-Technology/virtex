import { IsObject, IsOptional, IsString } from 'class-validator';

export class ExecutePluginDto {
  /** Run a registered extension by name (preferred). */
  @IsOptional()
  @IsString()
  pluginName?: string;

  /** Pin a specific version; defaults to the latest. */
  @IsOptional()
  @IsString()
  version?: string;

  /**
   * Run arbitrary code directly. Still passes the full admission pipeline before execution — it is
   * never trusted just because it was supplied inline.
   */
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsObject()
  sbom?: unknown;
}
