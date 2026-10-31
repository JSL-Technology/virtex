import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { Public } from '../../security/decorators/public.decorator';
import { SkipCsrf } from '../../security/decorators/skip-csrf.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { BadRequestError } from '../../i18n/localized.exception';
import { AzulPaymentAdapter } from '../adapters/azul-payment.adapter';

const OUTCOMES = ['approved', 'declined', 'cancelled'] as const;
type Outcome = (typeof OUTCOMES)[number];

/**
 * The buyer's round trip through Azul's Payment Page. Public: the buyer arrives from the signup
 * checkout before having an account, and returns from Azul's domain. Each request names a checkout
 * by its id, and a return is trusted only when Azul's `AuthHash` over it verifies.
 */
@ApiExcludeController()
@Controller('payment/azul')
@Public()
@SkipCsrf()
@UseGuards(ThrottlerGuard)
export class AzulController {
  constructor(private readonly azul: AzulPaymentAdapter) {}

  /** The page that posts the signed request to Azul. */
  @Get('pay/:id')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async pay(@Param('id', UuidParamPipe) id: string, @Res() reply: FastifyReply) {
    const html = await this.azul.paymentPage(id);
    return reply
      .header('Cache-Control', 'no-store')
      .header('Content-Security-Policy', "default-src 'none'; form-action https://pruebas.azul.com.do https://pagos.azul.com.do; script-src 'unsafe-inline'")
      .type('text/html; charset=utf-8')
      .send(html);
  }

  /** Where Azul sends the buyer back: the outcome is recorded and the buyer continues. */
  @Get('return/:id/:outcome')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async back(
    @Param('id', UuidParamPipe) id: string,
    @Param('outcome') outcome: string,
    @Query() query: Record<string, string>,
    @Res() reply: FastifyReply,
  ) {
    if (!(OUTCOMES as readonly string[]).includes(outcome)) throw new BadRequestError('payment.azul_response_not_authentic');
    const next = await this.azul.completeReturn(id, outcome as Outcome, query);
    return reply.status(303).header('Cache-Control', 'no-store').redirect(next);
  }
}
