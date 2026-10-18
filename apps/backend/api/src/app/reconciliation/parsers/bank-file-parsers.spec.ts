import { detectFormat, parseCamt053, parseOfx } from './bank-file-parsers';

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>DOP
<BANKTRANLIST>
<DTSTART>20261001
<DTEND>20261031
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261003120000[-4:AST]
<TRNAMT>15000.00
<FITID>A1
<NAME>DEPOSITO TRANSFERENCIA
<MEMO>FACT F-0012 DISTRIBUIDORA CARIBE
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261005
<TRNAMT>-350.50
<FITID>A2
<CHECKNUM>00045
<NAME>COMISION MANEJO CUENTA
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>64649.50
<DTASOF>20261031
</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
 <BkToCstmrStmt><Stmt>
  <FrToDt><FrDtTm>2026-10-01T00:00:00</FrDtTm><ToDtTm>2026-10-31T23:59:59</ToDtTm></FrToDt>
  <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="DOP">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-01</Dt></Dt></Bal>
  <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="DOP">1900.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-31</Dt></Dt></Bal>
  <Ntry>
   <Amt Ccy="DOP">1200.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
   <BookgDt><Dt>2026-10-04</Dt></BookgDt><AcctSvcrRef>BNK-77</AcctSvcrRef>
   <NtryDtls><TxDtls><Refs><EndToEndId>F-0013</EndToEndId></Refs>
    <AmtDtls><TxAmt><Amt Ccy="DOP">1200.00</Amt></TxAmt></AmtDtls>
    <RltdPties><Dbtr><Nm>Hermanos Peña &amp; Asociados</Nm></Dbtr></RltdPties>
    <RmtInf><Ustrd>Pago factura F-0013</Ustrd></RmtInf>
   </TxDtls></NtryDtls>
  </Ntry>
  <Ntry>
   <Amt Ccy="DOP">300.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>
   <BookgDt><DtTm>2026-10-09T10:00:00</DtTm></BookgDt>
   <AddtlNtryInf>Pago luz EDESUR</AddtlNtryInf>
  </Ntry>
 </Stmt></BkToCstmrStmt>
</Document>`;

describe('bank file parsers', () => {
  it('recognises each format by its content', () => {
    expect(detectFormat(Buffer.from(OFX_SGML))).toBe('ofx');
    expect(detectFormat(Buffer.from(CAMT))).toBe('camt053');
    expect(detectFormat(Buffer.from('Fecha,Descripción,Monto\n01/10/2026,X,10'))).toBe('csv');
  });

  it('reads OFX 1.x SGML, whose tags are never closed, with signs, references and balances', () => {
    const file = parseOfx(Buffer.from(OFX_SGML));
    expect(file.transactions).toEqual([
      { date: '2026-10-03', description: 'DEPOSITO TRANSFERENCIA — FACT F-0012 DISTRIBUIDORA CARIBE', reference: 'A1', debit: 15000, credit: 0, sourceRow: 1 },
      { date: '2026-10-05', description: 'COMISION MANEJO CUENTA', reference: '00045', debit: 0, credit: 350.5, sourceRow: 2 },
    ]);
    expect(file).toMatchObject({ endingBalance: 64649.5, startingBalance: 50000, startDate: '2026-10-01', endDate: '2026-10-31', currency: 'DOP' });
  });

  it('reads camt.053: direction, booking date, the party, remittance, end-to-end reference, balances', () => {
    const file = parseCamt053(Buffer.from(CAMT));
    expect(file.transactions).toEqual([
      { date: '2026-10-04', description: 'Hermanos Peña & Asociados — Pago factura F-0013', reference: 'F-0013', debit: 1200, credit: 0, sourceRow: 1 },
      { date: '2026-10-09', description: 'Pago luz EDESUR', reference: null, debit: 0, credit: 300, sourceRow: 2 },
    ]);
    expect(file).toMatchObject({ startingBalance: 1000, endingBalance: 1900, startDate: '2026-10-01', endDate: '2026-10-31', currency: 'DOP' });
  });

  it('refuses a file with no movements or an unreadable date', () => {
    expect(() => parseOfx(Buffer.from('<OFX><BANKTRANLIST></BANKTRANLIST></OFX>'))).toThrow(/NO_ROWS/);
    expect(() => parseOfx(Buffer.from('<OFX><STMTTRN><DTPOSTED>ayer<TRNAMT>1</STMTTRN></OFX>'))).toThrow(/INVALID_DATE/);
  });

  it('does not resolve entities a file declares (no XXE)', () => {
    const evil = CAMT.replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]>').replace('Pago luz EDESUR', '&x;');
    expect(parseCamt053(Buffer.from(evil)).transactions[1].description).toBe('&x;');
  });
});
