// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketTaxes } from '../contracts';
import { withholdingConfiguredByTenant } from '../kit/taxes';
import { TENANT_CONFIGURED_WITHHOLDING, needsCredentials } from '../kit/coverage';

/** Brazil: how a sale is taxed. Rates are starting points the tenant's accountant confirms. */
export const taxes: MarketTaxes = {
  model: 'BY_JURISDICTION',
  nameKey: 'localization.country_pack.tax_name.icms_iss',
  principalTaxName: 'Tributos',
  scheme: {
    configurationRequired: true,
    configurationNote:
      'No Brasil o ICMS é estadual, o ISS é municipal e as alíquotas de PIS/COFINS dependem do regime (cumulativo ou não-cumulativo). Configure os tributos conforme o regime e a localização da empresa antes de emitir notas.',
    taxes: [],
  },
  withholding: withholdingConfiguredByTenant(
    'No Brasil a retenção de PIS/COFINS/CSLL, do INSS e do ISS depende do serviço prestado, do município e do regime tributário do prestador. Configure as retenções conforme o seu enquadramento antes de emitir com retenção.',
  ),
  serviceChargeRate: 0,
  coverage: {
    taxDetermination: needsCredentials(
      'ICMS estadual, ISS municipal, PIS/COFINS por regime',
      'as alíquotas das jurisdições onde tem obrigação, em Configurações → Impostos',
    ),
    withholding: TENANT_CONFIGURED_WITHHOLDING,
  },
};
