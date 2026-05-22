import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../storage.service';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LocalStorageStrategy implements StorageService {
  private readonly logger = new Logger(LocalStorageStrategy.name);
  private readonly uploadDir: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadDir = path.join(process.cwd(), 'apps/backend/api/public/uploads');
    this.baseUrl = '/uploads';

    if (!fs.existsSync(this.uploadDir)) {
      this.logger.log(`Creating upload directory: ${this.uploadDir}`);
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async upload(file: Express.Multer.File, subPath: string): Promise<string> {
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    const fullPath = path.join(this.uploadDir, filename);

    if (file.buffer) {
        await fs.promises.writeFile(fullPath, file.buffer);
    } else if (file.path) {
        // Handle temporary file from diskStorage
        await fs.promises.copyFile(file.path, fullPath);
        // Optionally clean up temp file, though Multer might do it or we rely on OS tmp cleanup
        try {
            await fs.promises.unlink(file.path);
        } catch (err) {
            this.logger.warn(`Failed to delete temp file ${file.path}: ${err.message}`);
        }
    } else {
        throw new Error('File has no buffer or path');
    }

    this.logger.log(`File saved to ${fullPath}`);
    return `${this.baseUrl}/${filename}`;
  }

  async delete(filePath: string): Promise<void> {
    try {
      const filename = path.basename(filePath);
      const fullPath = path.join(this.uploadDir, filename);
      if (fs.existsSync(fullPath)) {
        await fs.promises.unlink(fullPath);
      }
    } catch (error) {
      this.logger.error(`Failed to delete file: ${filePath}`, error);
    }
  }

  getUrl(filePath: string): string {
    return filePath;
  }
}
