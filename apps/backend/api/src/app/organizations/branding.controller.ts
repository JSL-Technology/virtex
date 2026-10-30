import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Logger, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';
import { BadRequestError } from '../i18n/localized.exception';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFile, spooledUploadPath, toUploadableFile } from '../common/interfaces/fastify-file.interface';
import { StorageService } from '../storage/storage.service';
import { Organization } from './entities/organization.entity';
import { OrgSettingsService } from './services/org-settings.service';

/** The typefaces the client can draw. Anything else would fall back silently to the default. */
export const BRANDING_FONTS = [
  'Inter', 'Roboto Slab', 'Source Code Pro', 'Lato', 'Montserrat', 'Merriweather', 'Poppins', 'Roboto', 'Open Sans', 'Playfair Display', 'Nunito',
] as const;

export class UpdateBrandingDto {
  /** `#rrggbb`. The client recomputes contrast from it; anything else is refused, not guessed. */
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'validation.constraints.matches' })
  @IsOptional()
  accentColor?: string;

  @IsIn(BRANDING_FONTS)
  @IsOptional()
  fontFamily?: string;

  @IsInt()
  @Min(0)
  @Max(24)
  @IsOptional()
  borderRadius?: number;
}

/** Raster images only: an SVG is a document that can carry script, and a logo is shown to everyone. */
const LOGO_TYPES = /^image\/(png|jpe?g|webp)$/;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The company's branding: what every member's browser draws the company with.
 *
 * Read by every member (the shell needs it to paint itself, like the company header); changed only
 * with `settings:edit_branding`. Before this, branding lived in one browser's storage and nothing
 * on the server held it.
 */
@ApiTags('Organizations')
@Controller('organizations/branding')
export class BrandingController {
  private readonly logger = new Logger(BrandingController.name);

  constructor(
    private readonly settings: OrgSettingsService,
    private readonly storage: StorageService,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
  ) {}

  @Get()
  @AuthenticatedOnly('Every member draws the company with its branding; it is not sensitive.')
  @ApiOperation({ summary: 'La marca de la empresa: color, tipografía, radio y logo.' })
  async get(@CurrentUser() user: AuthenticatedUser) {
    return this.view(user.organizationId);
  }

  @Patch()
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_BRANDING)
  @ApiOperation({ summary: 'Cambia la marca de la empresa.' })
  async update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateBrandingDto) {
    const current = (await this.settings.getForOrg(user.organizationId))?.branding ?? {};
    const next = { ...current };
    if (dto.accentColor !== undefined) next.accentColor = dto.accentColor.toLowerCase();
    if (dto.fontFamily !== undefined) next.fontFamily = dto.fontFamily;
    if (dto.borderRadius !== undefined) next.borderRadius = dto.borderRadius;
    await this.settings.update(user.organizationId, { branding: next });
    return this.view(user.organizationId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_BRANDING)
  @ApiOperation({ summary: 'Vuelve a la marca predeterminada (el logo se conserva).' })
  async reset(@CurrentUser() user: AuthenticatedUser) {
    await this.settings.update(user.organizationId, { branding: null });
    return this.view(user.organizationId);
  }

  @Post('logo')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_BRANDING)
  @ApiOperation({ summary: 'Sube el logo de la empresa (PNG, JPEG o WebP, 2 MB).' })
  @UseInterceptors(
    FastifyFileInterceptor('file', {
      fileFilter: (_req, file, cb) =>
        LOGO_TYPES.test(file.mimetype) ? cb(null, true) : cb(new BadRequestError('organizations.logo_type_not_allowed'), false),
      limits: { fileSize: LOGO_MAX_BYTES },
    }),
  )
  async uploadLogo(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: FastifyFile) {
    if (!file) throw new BadRequestError('organizations.logo_file_required');
    try {
      const stored = await this.storage.upload(toUploadableFile(file), `logos/${user.organizationId}`);
      await this.organizations.update({ id: user.organizationId }, { logoUrl: stored.url });
      return this.view(user.organizationId);
    } finally {
      const spooled = spooledUploadPath(file);
      if (spooled) await fs.unlink(spooled).catch((error: Error) => this.logger.warn(`No se pudo borrar ${spooled}: ${error.message}`));
    }
  }

  @Delete('logo')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_BRANDING)
  @ApiOperation({ summary: 'Quita el logo de la empresa.' })
  async removeLogo(@CurrentUser() user: AuthenticatedUser) {
    await this.organizations.update({ id: user.organizationId }, { logoUrl: null });
    return this.view(user.organizationId);
  }

  private async view(organizationId: string) {
    const [settings, organization] = await Promise.all([
      this.settings.getForOrg(organizationId),
      this.organizations.findOne({ where: { id: organizationId }, select: { id: true, logoUrl: true } }),
    ]);
    const branding = settings?.branding ?? {};
    return {
      accentColor: branding.accentColor ?? null,
      fontFamily: branding.fontFamily ?? null,
      borderRadius: branding.borderRadius ?? null,
      logoUrl: organization?.logoUrl ?? null,
    };
  }
}
