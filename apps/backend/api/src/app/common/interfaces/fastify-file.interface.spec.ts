import { tmpdir } from 'os';
import { join } from 'path';
import { spooledUploadPath, toUploadableFile, FastifyFile } from './fastify-file.interface';

describe('spooledUploadPath', () => {
  const spooled = join(tmpdir(), '0123456789abcdef0123456789abcdef.xlsx');

  it('accepts the path the upload interceptor spools to', () => {
    expect(spooledUploadPath({ path: spooled })).toBe(spooled);
    expect(spooledUploadPath({ path: join(tmpdir(), '0123456789abcdef0123456789abcdef') })).not.toBeNull();
  });

  it('treats a missing path as absent', () => {
    expect(spooledUploadPath({})).toBeNull();
    expect(spooledUploadPath({ path: '' })).toBeNull();
  });

  it.each([
    ['an absolute path elsewhere', '/etc/passwd'],
    ['a relative traversal', '../../etc/passwd'],
    ['a traversal that starts inside the temp dir', join(tmpdir(), '..', 'etc', 'passwd')],
    [
      'a spooled-looking name that climbs out',
      `${join(tmpdir(), '0123456789abcdef0123456789abcdef')}/../../etc/passwd`,
    ],
    ['a client-chosen name in the temp dir', join(tmpdir(), 'invoice.xlsx')],
    ['a sibling directory sharing the prefix', `${tmpdir()}-evil/0123456789abcdef0123456789abcdef`],
    ['a nested file under the temp dir', join(tmpdir(), 'sub', '0123456789abcdef0123456789abcdef')],
  ])('refuses %s', (_label, path) => {
    expect(spooledUploadPath({ path })).toBeNull();
  });

  it('hands storage only a validated path', () => {
    const file = {
      originalname: 'x.pdf',
      filename: 'f',
      mimetype: 'application/pdf',
      path: '/etc/shadow',
    } as FastifyFile;

    expect(toUploadableFile(file).path).toBeUndefined();
    expect(toUploadableFile({ ...file, path: spooled }).path).toBe(spooled);
  });
});
