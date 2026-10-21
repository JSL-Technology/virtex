import { Controller, Get, HttpCode, HttpStatus, Logger, Param, Post, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { promises as fs } from 'node:fs';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFile, spooledUploadPath } from '../common/interfaces/fastify-file.interface';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CheckFeature } from '../saas/contracts/entitlements.contract';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { AccountsPayableService } from './accounts-payable.service';
import { VendorBillAttachment } from './entities/vendor-bill-attachment.entity';
import { BillCaptureService, BillUpload, MAX_BILL_FILE_BYTES } from './bill-capture.service';
import { ShortLivedConnections } from '../shared/tenancy/short-lived-connections.decorator';

const ACCEPTED = /^(image\/(jpe?g|png|webp|gif|heic|heif|avif|tiff)|application\/pdf)$/i;

const fileInterceptor = () =>
  FastifyFileInterceptor('file', {
    fileFilter: (_req, file, cb) => {
      // A first filter only: the service decides by the bytes.
      if (!ACCEPTED.test(file.mimetype)) return cb(new BadRequestError('accounts_payable.attachment_unsupported'), false);
      cb(null, true);
    },
    limits: { fileSize: MAX_BILL_FILE_BYTES },
  });

/**
 * A supplier's document before its bill exists: read into a suggested bill, or just kept as the
 * evidence the bill will be saved with. Neither records a bill.
 */
@ApiTags('Accounts Payable')
@ApiBearerAuth()
@Controller('accounts-payable')
export class BillCaptureController {
  private readonly logger = new Logger(BillCaptureController.name);

  constructor(
    private readonly capture: BillCaptureService,
    private readonly bills: AccountsPayableService,
  ) {}

  @Post('capture')
  @ShortLivedConnections()
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_CREATE, PERMISSIONS.AI_BILL_CAPTURE_USE)
  @CheckFeature('ai_vision')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Read a supplier's invoice (photo or PDF) into a suggested bill. Keeps the file; records no bill." })
  @UseInterceptors(fileInterceptor())
  async read(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: FastifyFile) {
    return this.withUpload(file, (upload) => this.capture.capture(user.organizationId, user.id, upload));
  }

  @Post('attachments')
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_CREATE)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Keep a supplier's document for a bill being entered; it is claimed when the bill is saved." })
  @UseInterceptors(fileInterceptor())
  async stage(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: FastifyFile) {
    const attachment = await this.withUpload(file, (upload) => this.capture.stage(user.organizationId, user.id, upload));
    return publicAttachment(attachment);
  }

  @Get(':id/attachments')
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  @ApiOperation({ summary: "The supplier's documents kept with a bill." })
  async list(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    // Through the bill, so a branch the reader cannot see hides its documents too.
    await this.bills.findOne(id, user.organizationId, user.id);
    return (await this.capture.list(user.organizationId, id)).map(publicAttachment);
  }

  @Post(':id/attachments')
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_CREATE)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Add a supplier's document to a recorded bill." })
  @UseInterceptors(fileInterceptor())
  async attach(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string, @UploadedFile() file: FastifyFile) {
    await this.bills.findOne(id, user.organizationId, user.id);
    const attachment = await this.withUpload(file, (upload) => this.capture.stage(user.organizationId, user.id, upload));
    return publicAttachment(await this.capture.attach(user.organizationId, id, attachment));
  }

  @Get('attachments/:attachmentId/download')
  @HasPermission(PERMISSIONS.ACCOUNTS_PAYABLE_VIEW)
  async download(@CurrentUser() user: AuthenticatedUser, @Param('attachmentId', UuidParamPipe) attachmentId: string): Promise<StreamableFile> {
    const { attachment, file } = await this.capture.open(user.organizationId, attachmentId);
    if (attachment.vendorBillId) {
      await this.bills.findOne(attachment.vendorBillId, user.organizationId, user.id);
    } else if (attachment.uploadedByUserId !== user.id) {
      // A staged file belongs to the form it is being entered in, not to the whole company yet.
      file.stream.destroy();
      throw new NotFoundError('accounts_payable.attachment_not_found');
    }
    return new StreamableFile(file.stream, {
      type: attachment.mimeType,
      // RFC 6266/5987: the name is encoded, so a name with quotes or line breaks cannot break the header.
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      length: file.fileSize,
    });
  }

  private async withUpload<T>(file: FastifyFile | undefined, run: (upload: BillUpload) => Promise<T>): Promise<T> {
    if (!file) throw new BadRequestError('users.file_required');
    const spooled = spooledUploadPath(file);
    try {
      const buffer = file.buffer ?? (spooled ? await fs.readFile(spooled) : null);
      if (!buffer?.length) throw new BadRequestError('users.file_required');
      return await run({ fileName: file.originalname ?? file.filename ?? 'document', mimeType: file.mimetype, buffer });
    } finally {
      if (spooled) {
        await fs.unlink(spooled).catch((error) => this.logger.warn(`Failed to remove temporary upload ${spooled}: ${error.message}`));
      }
    }
  }
}

function publicAttachment(attachment: VendorBillAttachment) {
  return {
    id: attachment.id,
    vendorBillId: attachment.vendorBillId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
    createdAt: attachment.createdAt,
  };
}
