import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { FiscalAdapter } from '../interfaces/fiscal-adapter.interface';
import { GenericFiscalAdapter } from './generic-fiscal.adapter';
import { DominicanRepublicFiscalAdapter } from './dominican-republic-fiscal.adapter';
import {
  ArgentinaNumberingAdapter,
  BrazilNumberingAdapter,
  ChileNumberingAdapter,
  ColombiaNumberingAdapter,
  EcuadorNumberingAdapter,
  MexicoNumberingAdapter,
  PeruNumberingAdapter,
} from './regime-numbering.adapter';
import { Organization } from '../../organizations/entities/organization.entity';

/**
 * Picks the fiscal adapter for a tenant's market.
 *
 * Resolution is by ISO country code only. It used to also accept the literal string
 * `'Dominican Republic'`, a leftover from when `organizations.country` held a display name; keeping
 * both meant two spellings of one fact and no guarantee which one a row carried. Registration now
 * always writes the alpha-2 code.
 *
 * ## What changed, and why it was the heart of H18
 *
 * Until now this switch had one case. Every other market — including the six whose regimes are
 * implemented, tested and signed — fell to `GenericFiscalAdapter` and got
 * `{ ncf: null, documentType: null, expiresAt: null }`. A Mexican tenant was shown the CFDI 4.0
 * requirement at signup, had their RFC validated, paid, and then issued documents that no
 * authority had ever seen. Building the document was never the missing half; this was.
 *
 * `GenericFiscalAdapter` stays, and is still the right answer for the twelve markets whose regime
 * is genuinely not implemented. Saying so is not the same as pretending.
 */
@Injectable()
export class FiscalAdapterFactory {
  constructor(
    private readonly genericAdapter: GenericFiscalAdapter,
    private readonly drAdapter: DominicanRepublicFiscalAdapter,
    private readonly mxAdapter: MexicoNumberingAdapter,
    private readonly coAdapter: ColombiaNumberingAdapter,
    private readonly peAdapter: PeruNumberingAdapter,
    private readonly ecAdapter: EcuadorNumberingAdapter,
    private readonly clAdapter: ChileNumberingAdapter,
    private readonly brAdapter: BrazilNumberingAdapter,
    private readonly arAdapter: ArgentinaNumberingAdapter,
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
  ) {}

  /** Adapter for an organization, resolved inside the caller's transaction when one is given. */
  async getAdapter(organizationId: string, manager?: EntityManager): Promise<FiscalAdapter> {
    const repo = manager ? manager.getRepository(Organization) : this.orgRepository;
    const organization = await repo.findOne({
      where: { id: organizationId },
      select: ['id', 'country'],
    });
    return this.forCountry(organization?.country ?? null);
  }

  forCountry(countryCode: string | null): FiscalAdapter {
    switch ((countryCode ?? '').toUpperCase()) {
      case 'DO':
        return this.drAdapter;
      case 'MX':
        return this.mxAdapter;
      case 'CO':
        return this.coAdapter;
      case 'PE':
        return this.peAdapter;
      case 'EC':
        return this.ecAdapter;
      case 'CL':
        return this.clAdapter;
      case 'BR':
        return this.brAdapter;
      case 'AR':
        return this.arAdapter;
      default:
        return this.genericAdapter;
    }
  }
}
