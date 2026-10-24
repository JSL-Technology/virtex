import { htmlToText, parseInboundMail, senderAllowed, signPayload, tokenOf, verifySignature } from './inbound-payload';

describe('inbound mail payload', () => {
  const secret = 'a'.repeat(40);
  const body = Buffer.from('{"x":1}');

  it('accepts only a fresh signature over the exact bytes', () => {
    const now = 1_800_000_000;
    const header = `t=${now},v1=${signPayload(secret, now, body)}`;
    expect(verifySignature(secret, header, body, now + 10)).toBe(true);
    expect(verifySignature(secret, header, Buffer.from('{"x":2}'), now)).toBe(false);
    expect(verifySignature(secret, header, body, now + 301)).toBe(false);
    expect(verifySignature('b'.repeat(40), header, body, now)).toBe(false);
    expect(verifySignature(secret, undefined, body, now)).toBe(false);
    expect(verifySignature('', header, body, now)).toBe(false);
  });

  it('finds the mailbox token only in an address on our domain', () => {
    const token = 'Ab3_dEf9-ghIJklmNOPq';
    expect(tokenOf(`Bills <bills+${token}@in.virtex.app>`, 'in.virtex.app')).toBe(token.toLowerCase());
    expect(tokenOf(`bills+${token}@other.com`, 'in.virtex.app')).toBeNull();
    expect(tokenOf('bills@in.virtex.app', 'in.virtex.app')).toBeNull();
  });

  it('normalises a message and leaves out what no handler reads', () => {
    const parsed = parseInboundMail({
      to: ['bills+tok@in.virtex.app'],
      from: '"Ana Pérez" <Ana@Supplier.com>',
      subject: 'Factura\r\nB0100000123',
      messageId: '<1@mail>',
      html: '<p>Adjunto la <b>factura</b></p><script>x()</script>',
      authentication: { spf: 'pass', dkim: 'fail' },
      attachments: [
        { fileName: '../factura.pdf', contentType: 'application/pdf; name=x', contentBase64: Buffer.from('%PDF').toString('base64') },
        { fileName: 'virus.exe', contentType: 'application/octet-stream', contentBase64: 'AAAA' },
      ],
    });
    expect(parsed).toMatchObject({ from: 'ana@supplier.com', fromName: 'Ana Pérez', subject: 'Factura B0100000123', text: 'Adjunto la factura', authenticated: false });
    expect(parsed.attachments.map((item) => item.fileName)).toEqual(['.._factura.pdf']);
    expect(parsed.skipped).toEqual([{ fileName: 'virus.exe', reason: 'type' }]);
    expect(() => parseInboundMail({ to: 'x', from: 'y' })).toThrow();
  });

  it('lets a mailbox narrow its senders to addresses or domains', () => {
    expect(senderAllowed('ana@supplier.com', [])).toBe(true);
    expect(senderAllowed('ana@supplier.com', ['@supplier.com'])).toBe(true);
    expect(senderAllowed('ana@evil.com', ['@supplier.com', 'bob@x.com'])).toBe(false);
  });

  it('reads HTML as text', () => {
    expect(htmlToText('a&nbsp;&amp;<br>b')).toBe('a &\nb');
  });
});
