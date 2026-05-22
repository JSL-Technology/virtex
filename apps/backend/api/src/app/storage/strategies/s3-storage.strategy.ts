import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../storage.service';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';

@Injectable()
export class S3StorageStrategy implements StorageService {
  private readonly logger = new Logger(S3StorageStrategy.name);
  private readonly s3: S3Client;
  private readonly bucketName: string;
  private readonly region: string;

  constructor(private readonly configService: ConfigService) {
    this.region = this.configService.get<string>('AWS_REGION', 'us-east-1');
    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME', '');

    this.s3 = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
  }

  async upload(file: Express.Multer.File, subPath: string): Promise<string> {
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    const key = `avatars/${filename}`;

    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',
      }));

      return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
    } catch (error) {
      this.logger.error(`S3 Upload Error: ${error.message}`, error);
      throw error;
    }
  }

  async delete(fileUrl: string): Promise<void> {
    try {
        const url = new URL(fileUrl);
        const key = url.pathname.substring(1);

        await this.s3.send(new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: key
        }));
    } catch (error) {
        this.logger.error(`S3 Delete Error: ${error.message}`, error);
    }
  }

  getUrl(path: string): string {
    return path;
  }
}
