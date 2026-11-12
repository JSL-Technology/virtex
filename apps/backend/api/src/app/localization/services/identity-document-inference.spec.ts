import { DataSource } from 'typeorm';
import { describeWithDb, openTestDataSource } from '../../common/database/testing/integration-db';
import { IdentityDocumentType } from '../entities/identity-document-type.entity';
import { IdentityDocumentService } from './identity-document.service';

/**
 * A document sent with no type is recognised by its shape (audit 2026-11-07, CMP-16).
 *
 * A valid nine-digit Dominican RNC with no type was checked as an eleven-digit cédula, because the
 * cédula is the first default, and refused with «document_invalid {document: "Cédula"}». The
 * catalogue — pattern and check digit — decides now, for any country.
 */
describeWithDb('IdentityDocumentService type inference', () => {
  let ds: DataSource;
  let service: IdentityDocumentService;

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new IdentityDocumentService(ds.getRepository(IdentityDocumentType));
    await service.onModuleInit();
  });
  afterAll(async () => ds?.destroy());

  const resolve = (value: string, typeCode?: string) =>
    service.resolveParty({ value, typeCode, documentCountry: 'DO', fallbackCountry: 'DO', appliesTo: 'both', usedFor: 'invoicing' });

  it('reads nine digits with a valid check digit as an RNC', async () => {
    expect(await resolve('131246796')).toMatchObject({ ok: true, typeCode: 'RNC', value: '131246796' });
  });

  it('reads eleven digits with a valid check digit as a cédula', async () => {
    // 001-0000001-? : check digit computed by the Luhn variant the JCE uses.
    const base = '0010000001';
    const digits = base.split('').map(Number);
    const sum = digits.reduce((acc, digit, i) => {
      const product = digit * (i % 2 === 0 ? 1 : 2);
      return acc + (product > 9 ? product - 9 : product);
    }, 0);
    const cedula = base + String((10 - (sum % 10)) % 10);
    expect(await resolve(cedula)).toMatchObject({ ok: true, typeCode: 'CEDULA' });
  });

  it('still refuses a value that is no valid document, naming the default document', async () => {
    expect(await resolve('131246797')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('honours an explicit type over the inference', async () => {
    expect(await resolve('131246796', 'CEDULA')).toMatchObject({ ok: false, reason: 'invalid', code: 'CEDULA' });
  });
});
