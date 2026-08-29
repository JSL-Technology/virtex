import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import {
  StorageService,
  StoredFile,
  StoredFileStream,
  UploadableFile,
} from '../storage.service';

/**
 * S3 storage.
 *
 * Two things changed here beyond the contract, and both were exposures rather than tidiness:
 *
 *  - `ACL: 'public-read'` made every uploaded object world-readable at a guessable URL. That
 *    included journal-entry attachments and audit evidence — an accounting product's most
 *    sensitive documents — not just avatars. Objects are private now, and `getUrl` issues a
 *    time-limited presigned URL instead.
 *  - The key was hardcoded to `avatars/${filename}` and `subPath` was ignored, so every object in
 *    the product shared one prefix regardless of tenant or kind. That defeats any per-prefix
 *    lifecycle rule or bucket policy an operator might write.
 */
@Injectable()
export class S3StorageStrategy implements StorageService {
  private readonly logger = new Logger(S3StorageStrategy.name);
  private readonly s3: S3Client;
  private readonly bucketName: string;
  private readonly region: string;
  private readonly signedUrlTtlSeconds: number;

  constructor(private readonly configService: ConfigService) {
    this.region = this.configService.get<string>('AWS_REGION', 'us-east-1');
    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME', '');
    this.signedUrlTtlSeconds = this.configService.get<number>('S3_SIGNED_URL_TTL_SECONDS', 900);

    this.s3 = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
  }

  async upload(file: UploadableFile, subPath: string): Promise<StoredFile> {
    const key = `${S3StorageStrategy.sanitizeSubPath(subPath)}/${Date.now()}-${randomBytes(8).toString('hex')}${path.extname(file.fileName)}`;
    const body = file.buffer ?? (await this.readFromDisk(file));

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: body,
          ContentType: file.mimeType,
          // No ACL: the object is private and reached only through a presigned URL.
        }),
      );

      return {
        storageKey: key,
        url: await this.getUrl(key),
        fileSize: body.byteLength,
        mimeType: file.mimeType,
      };
    } catch (error) {
      this.logger.error(`S3 Upload Error: ${(error as Error).message}`, error);
      throw error;
    }
  }

  async getStream(storageKey: string): Promise<StoredFileStream> {
    try {
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucketName, Key: storageKey }),
      );

      return {
        stream: result.Body as Readable,
        fileSize: result.ContentLength ?? 0,
        mimeType: result.ContentType ?? 'application/octet-stream',
      };
    } catch (error) {
      this.logger.warn(`S3 object unavailable (${storageKey}): ${(error as Error).message}`);
      throw new NotFoundException('El archivo no está disponible.');
    }
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucketName, Key: storageKey }),
      );
    } catch (error) {
      this.logger.error(`S3 Delete Error: ${(error as Error).message}`, error);
    }
  }

  /** A time-limited URL. Objects are private, so an unsigned URL would simply be refused. */
  async getUrl(storageKey: string): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucketName, Key: storageKey }),
      { expiresIn: this.signedUrlTtlSeconds },
    );
  }

  private async readFromDisk(file: UploadableFile): Promise<Buffer> {
    if (!file.path) throw new Error('File has no buffer or path');
    const fs = await import('fs/promises');
    return fs.readFile(file.path);
  }

  private static sanitizeSubPath(subPath: string): string {
    return (subPath || 'misc').replace(/[^a-zA-Z0-9/_-]/g, '').replace(/\.{2,}/g, '');
  }
}
