import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import {
  StorageService,
  StoredFile,
  StoredFileStream,
  UploadableFile,
} from '../storage.service';
import { NotFoundError } from '../../i18n/localized.exception';

/**
 * Filesystem storage, for development and single-node deployments.
 *
 * Objects are stored under `<uploadDir>/<subPath>/<key>`, and `subPath` is honoured — the S3
 * strategy used to ignore it and put every object in one folder regardless of what it was.
 */
@Injectable()
export class LocalStorageStrategy implements StorageService {
  private readonly logger = new Logger(LocalStorageStrategy.name);
  private readonly uploadDir: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadDir = path.join(process.cwd(), 'apps/backend/api/public/uploads');
    this.baseUrl = this.configService.get<string>('STORAGE_PUBLIC_BASE_URL', '/uploads');

    if (!fs.existsSync(this.uploadDir)) {
      this.logger.log(`Creating upload directory: ${this.uploadDir}`);
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async upload(file: UploadableFile, subPath: string): Promise<StoredFile> {
    const key = path.posix.join(
      LocalStorageStrategy.sanitizeSubPath(subPath),
      `${Date.now()}-${randomBytes(8).toString('hex')}${path.extname(file.fileName)}`,
    );
    const fullPath = this.resolve(key);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });

    if (file.buffer) {
      await fs.promises.writeFile(fullPath, file.buffer);
    } else if (file.path) {
      await fs.promises.copyFile(file.path, fullPath);
      try {
        await fs.promises.unlink(file.path);
      } catch (err) {
        this.logger.warn(`Failed to delete temp file ${file.path}: ${(err as Error).message}`);
      }
    } else {
      throw new Error('File has no buffer or path');
    }

    const { size } = await fs.promises.stat(fullPath);
    return { storageKey: key, url: `${this.baseUrl}/${key}`, fileSize: size, mimeType: file.mimeType };
  }

  async getStream(storageKey: string): Promise<StoredFileStream> {
    const fullPath = this.resolve(storageKey);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(fullPath);
    } catch {
      throw new NotFoundError('STORAGE.ARCHIVO_NO_ESTA_DISPONIBLE');
    }

    return {
      stream: fs.createReadStream(fullPath) as Readable,
      fileSize: stat.size,
      mimeType: 'application/octet-stream',
    };
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await fs.promises.unlink(this.resolve(storageKey));
    } catch (error) {
      this.logger.error(`Failed to delete file: ${storageKey}`, error);
    }
  }

  async getUrl(storageKey: string): Promise<string> {
    return `${this.baseUrl}/${storageKey}`;
  }

  /**
   * Resolve a key to a path INSIDE the upload directory, and refuse anything else.
   *
   * Keys reach this class from database rows, and a row holding `../../etc/passwd` would otherwise
   * be read and served. `path.resolve` collapses the traversal; the prefix check is what makes the
   * result safe to open.
   */
  private resolve(storageKey: string): string {
    const full = path.resolve(this.uploadDir, storageKey);
    if (full !== this.uploadDir && !full.startsWith(this.uploadDir + path.sep)) {
      throw new NotFoundError('STORAGE.ARCHIVO_NO_ESTA_DISPONIBLE');
    }
    return full;
  }

  private static sanitizeSubPath(subPath: string): string {
    return (subPath || 'misc').replace(/[^a-zA-Z0-9/_-]/g, '').replace(/\.{2,}/g, '');
  }
}
