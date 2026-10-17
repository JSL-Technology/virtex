import sharp from 'sharp';
import { ProductImagesService } from './product-images.service';

/**
 * What happens to a photo on its way into the catalogue — run against the real image library,
 * because "the metadata is stripped" is only true if the bytes say so.
 */
describe('ProductImagesService.storeImage', () => {
  const build = () => {
    const uploads: Array<{ buffer: Buffer; subPath: string }> = [];
    const images = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => ({ ...row, id: 'img-1' })),
    };
    const storage = {
      upload: jest.fn(async (file: { buffer: Buffer }, subPath: string) => {
        uploads.push({ buffer: file.buffer, subPath });
        return { storageKey: `${subPath}/x.jpg`, url: 'https://files/x.jpg', fileSize: file.buffer.length, mimeType: 'image/jpeg' };
      }),
    };
    const service = new ProductImagesService(images as never, {} as never, {} as never, storage as never, {} as never);
    return { service, uploads, images };
  };

  /** A 3000×2000 photo carrying a GPS position and an "rotate 90°" orientation flag. */
  const phonePhoto = () =>
    sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 120, b: 40 } } })
      .withExif({ IFD0: { Make: 'PhoneCo' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '18/1 28/1 0/1' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

  it('strips every piece of metadata, GPS included', async () => {
    const { service, uploads } = build();
    const original = await phonePhoto();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    await service.storeImage('org-1', 'user-1', { fileName: 'p.jpg', mimeType: 'image/jpeg', buffer: original });

    const stored = await sharp(uploads[0].buffer).metadata();
    expect(stored.exif).toBeUndefined();
    expect(uploads[0].buffer.includes(Buffer.from('PhoneCo'))).toBe(false);
  });

  it('applies the orientation to the pixels and bounds the longest side', async () => {
    const { service, uploads } = build();
    const result = await service.storeImage('org-1', null, {
      fileName: 'p.jpg',
      mimeType: 'image/jpeg',
      buffer: await phonePhoto(),
    });
    // Orientation 6 is a portrait photo stored sideways: once applied, it is taller than wide.
    expect(result.height).toBe(1568);
    expect(result.width).toBeLessThan(result.height);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(uploads[0].subPath).toBe('product-images/org-1');
  });

  it('refuses bytes that are not an image, whatever their declared type', async () => {
    const { service, uploads } = build();
    await expect(
      service.storeImage('org-1', null, {
        fileName: 'fake.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('<?php system($_GET["c"]); ?>'),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(uploads).toHaveLength(0);
  });

  it('stores the same picture once, however many times it is uploaded', async () => {
    const { service, uploads, images } = build();
    const photo = await phonePhoto();
    await service.storeImage('org-1', null, { fileName: 'a.jpg', mimeType: 'image/jpeg', buffer: photo });
    images.findOne.mockResolvedValue({ id: 'img-1', sha256: 'x' });
    const again = await service.storeImage('org-1', null, { fileName: 'a.jpg', mimeType: 'image/jpeg', buffer: photo });
    expect(again.id).toBe('img-1');
    expect(uploads).toHaveLength(1);
  });
});
