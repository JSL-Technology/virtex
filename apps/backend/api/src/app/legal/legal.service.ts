import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LEGAL_DOCUMENTS, LegalDocumentEdition, LegalDocumentId, matchLanguage } from '@virteex/shared/types';
import { MarketWaitlistEntry } from './market-waitlist.entity';
import { MarketWaitlistDto } from './dto/market-waitlist.dto';

/** What the public legal pages need from the server. */
export interface LegalInfo {
  /** Where customers write for help. Never empty. */
  supportEmail: string;
  documents: Record<LegalDocumentId, LegalDocumentEdition>;
}

/** Last resort when a development machine configures no address at all. */
const FALLBACK_SUPPORT_EMAIL = 'support@virtex.app';

/**
 * The public legal surface: the editions in force, the support channel, and the waitlist for
 * markets the product does not serve yet (QA C-08, A-13).
 */
@Injectable()
export class LegalService {
  private readonly logger = new Logger(LegalService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(MarketWaitlistEntry) private readonly waitlist: Repository<MarketWaitlistEntry>,
  ) {}

  /**
   * The support address: `SUPPORT_EMAIL`, else the address mail is sent from — which every
   * deployment must configure — unless that is a no-reply sender, else the product's default
   * support mailbox.
   */
  supportEmail(): string {
    const configured = this.config.get<string>('SUPPORT_EMAIL')?.trim();
    if (configured) return configured;
    // A "no-reply" sender is, by its own name, not a channel anybody should be told to write to.
    const sender = this.config.get<string>('MAIL_FROM_ADDRESS')?.trim();
    return sender && !/^no-?reply@/i.test(sender) ? sender : FALLBACK_SUPPORT_EMAIL;
  }

  info(): LegalInfo {
    return { supportEmail: this.supportEmail(), documents: { ...LEGAL_DOCUMENTS } };
  }

  /**
   * Remember that somebody wants the product in their country.
   *
   * Idempotent per address and country: asking again refreshes the row instead of adding one, so
   * the list counts people rather than clicks. The answer is the same whether the row was new or
   * not — it says nothing about who else asked.
   */
  async joinWaitlist(dto: MarketWaitlistDto, ipAddress: string | null): Promise<void> {
    const countryCode = dto.countryCode.toUpperCase();
    await this.waitlist
      .createQueryBuilder()
      .insert()
      .into(MarketWaitlistEntry)
      .values({
        email: dto.email,
        countryCode,
        language: matchLanguage(dto.language) ?? null,
        ipAddress: ipAddress?.slice(0, 64) ?? null,
      })
      .orUpdate(['language', 'ip_address', 'updated_at'], ['email', 'country_code'])
      .execute();
    this.logger.log({ event: 'market_waitlist_joined', countryCode }, 'A visitor asked to be told when we open in their country.');
  }
}
