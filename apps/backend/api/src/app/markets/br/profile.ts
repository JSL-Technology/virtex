// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * IBGE unidades federativas. The UF is what an NF-e carries, and it decides the ICMS regime,
 * so free text here is not a smaller problem than a missing field.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['AC', 'Acre'],
  ['AL', 'Alagoas'],
  ['AP', 'Amapá'],
  ['AM', 'Amazonas'],
  ['BA', 'Bahia'],
  ['CE', 'Ceará'],
  ['DF', 'Distrito Federal'],
  ['ES', 'Espírito Santo'],
  ['GO', 'Goiás'],
  ['MA', 'Maranhão'],
  ['MT', 'Mato Grosso'],
  ['MS', 'Mato Grosso do Sul'],
  ['MG', 'Minas Gerais'],
  ['PA', 'Pará'],
  ['PB', 'Paraíba'],
  ['PR', 'Paraná'],
  ['PE', 'Pernambuco'],
  ['PI', 'Piauí'],
  ['RJ', 'Rio de Janeiro'],
  ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'],
  ['RO', 'Rondônia'],
  ['RR', 'Roraima'],
  ['SC', 'Santa Catarina'],
  ['SP', 'São Paulo'],
  ['SE', 'Sergipe'],
  ['TO', 'Tocantins'],
].map(([code, name]) => ({ code, name }));

/** Brazil: who the market is. */
export const profile: MarketProfile = {
  name: 'Brasil',
  currency: 'BRL',
  locale: 'pt-BR',
  booksLanguage: 'pt',
  timeZone: 'America/Sao_Paulo',
  callingCode: '55',
  fiscalAuthority: 'Receita Federal',
  address: {
    divisionLabel: 'Estado',
    divisionLabelKey: 'fiscal.labels.state',
    divisions: DIVISIONS,
    postalCodeLabel: 'CEP',
    postalCodePattern: '^\\d{5}-?\\d{3}$',
    postalCodeRequired: true,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',' },
  examples: { city: 'São Paulo', postalCode: '01310-100', phone: '(11) 5555-0123' },
  marketStatus: 'available',
};
