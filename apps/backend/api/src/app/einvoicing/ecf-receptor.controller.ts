import { Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../security/decorators/public.decorator';
import { SkipCsrf } from '../security/decorators/skip-csrf.decorator';
import { BadRequestError } from '../i18n/localized.exception';
import { EcfReceptorService } from './services/ecf-receptor.service';

/** Largest e-CF accepted. A comprobante with a thousand lines is well under it. */
const MAX_XML_BYTES = 2 * 1024 * 1024;

/**
 * The tenant's e-CF reception services, at the paths the DGII's specification fixes, under a base
 * per tenant: `{api}/dgii/{rnc}`. That base is what the tenant registers in the DGII's directory of
 * electronic issuers (see `docs/RECEPCION_ECF.md`).
 *
 * Public by necessity — suppliers and the DGII call them — and authenticated the way the DGII
 * defines: a seed signed with the caller's certificate buys a short-lived bearer token. No session
 * cookie is involved, so CSRF does not apply.
 */
@ApiExcludeController()
@Controller('dgii/:rnc/fe')
@Public()
@SkipCsrf()
@UseGuards(ThrottlerGuard)
export class EcfReceptorController {
  constructor(private readonly receptor: EcfReceptorService) {}

  @Get('autenticacion/api/semilla')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async seed(@Param('rnc') rnc: string, @Res() reply: FastifyReply) {
    const xml = await this.receptor.seed(rnc);
    return reply.type('application/xml; charset=utf-8').send(xml);
  }

  @Post('autenticacion/api/validacioncertificado')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async validate(@Param('rnc') rnc: string, @Req() req: FastifyRequest) {
    return this.receptor.validateSeed(rnc, await readXml(req));
  }

  /** An e-CF from a supplier. Always answered with a signed ARECF — «recibido» or why not. */
  @Post('recepcion/api/ecf')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async receive(
    @Param('rnc') rnc: string,
    @Headers('authorization') authorization: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    this.receptor.assertToken(rnc, authorization);
    const result = await this.receptor.receive(rnc, await readXml(req));
    return reply.status(HttpStatus.OK).type('application/xml; charset=utf-8').send(result.ackXml);
  }

  /** A customer's commercial approval (ACECF) of a document this tenant issued. */
  @Post('aprobacioncomercial/api/ecf')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async commercialApproval(
    @Param('rnc') rnc: string,
    @Headers('authorization') authorization: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    this.receptor.assertToken(rnc, authorization);
    return this.receptor.receiveCommercialApproval(rnc, await readXml(req));
  }
}

/** The XML a caller sent: a multipart file (the DGII's convention) or a raw XML body. */
async function readXml(req: FastifyRequest): Promise<string> {
  const body = req.body as unknown;
  if (typeof body === 'string') return guard(Buffer.from(body, 'utf8'));
  if (body && typeof body === 'object') {
    for (const part of Object.values(body as Record<string, unknown>)) {
      const file = Array.isArray(part) ? part[0] : part;
      if (file && typeof (file as { toBuffer?: unknown }).toBuffer === 'function') {
        return guard(await (file as { toBuffer: () => Promise<Buffer> }).toBuffer());
      }
      if (file && typeof (file as { value?: unknown }).value === 'string' && String((file as { value: string }).value).trim().startsWith('<')) {
        return guard(Buffer.from((file as { value: string }).value, 'utf8'));
      }
    }
  }
  throw new BadRequestError('einvoicing.receptor.xml_missing');
}

function guard(buffer: Buffer): string {
  if (buffer.length === 0) throw new BadRequestError('einvoicing.receptor.xml_missing');
  if (buffer.length > MAX_XML_BYTES) throw new BadRequestError('einvoicing.receptor.xml_too_large');
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}
