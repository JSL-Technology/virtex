import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EcfCertificate } from '../entities/ecf-certificate.entity';
import { CertificateVaultService } from './certificate-vault.service';
import { BadRequestError } from '../../i18n/localized.exception';

/** Certificate view without any encrypted material — safe to return over the API. */
export interface EcfCertificateView {
  id: string;
  alias: string;
  subjectCommonName?: string;
  serialNumber?: string;
  notBefore?: Date;
  notAfter?: Date;
  isActive: boolean;
  expired: boolean;
  createdAt: Date;
}

/**
 * Manages a tenant's DGII signing certificates: validates the PKCS#12 and password up front,
 * encrypts them at rest through the vault, and keeps exactly one active certificate per tenant.
 */
@Injectable()
export class EcfCertificateService {
  constructor(
    @InjectRepository(EcfCertificate)
    private readonly repo: Repository<EcfCertificate>,
    private readonly vault: CertificateVaultService,
  ) {}

  async upload(
    organizationId: string,
    input: { pfx: Buffer; password: string; alias: string },
  ): Promise<EcfCertificateView> {
    if (!input.pfx?.length) throw new BadRequestError('EINVOICING.ARCHIVO_CERTIFICADO_ESTA_VACIO');
    if (!input.password) throw new BadRequestError('EINVOICING.CONTRASENA_CERTIFICADO_ES_OBLIGATORIA');

    // Validate before persisting — a bad password / malformed file throws here, not at signing time.
    const parsed = this.vault.parsePkcs12(input.pfx, input.password);

    return this.repo.manager.transaction(async (manager) => {
      await manager.getRepository(EcfCertificate).update({ organizationId, isActive: true }, { isActive: false });

      const entity = manager.create(EcfCertificate, {
        organizationId,
        alias: input.alias || parsed.subjectCommonName || 'Certificado DGII',
        encryptedPfx: this.vault.encrypt(input.pfx),
        encryptedPassword: this.vault.encrypt(input.password),
        subjectCommonName: parsed.subjectCommonName,
        serialNumber: parsed.serialNumber,
        notBefore: parsed.notBefore,
        notAfter: parsed.notAfter,
        isActive: true,
      });
      const saved = await manager.save(entity);
      return this.toView(saved);
    });
  }

  async list(organizationId: string): Promise<EcfCertificateView[]> {
    const rows = await this.repo.find({ where: { organizationId }, order: { createdAt: 'DESC' } });
    return rows.map((r) => this.toView(r));
  }

  async deactivate(organizationId: string, id: string): Promise<void> {
    await this.repo.update({ id, organizationId }, { isActive: false });
  }

  private toView(c: EcfCertificate): EcfCertificateView {
    return {
      id: c.id,
      alias: c.alias,
      subjectCommonName: c.subjectCommonName,
      serialNumber: c.serialNumber,
      notBefore: c.notBefore,
      notAfter: c.notAfter,
      isActive: c.isActive,
      expired: c.notAfter ? c.notAfter.getTime() < Date.now() : false,
      createdAt: c.createdAt,
    };
  }
}
