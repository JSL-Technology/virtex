
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, BadRequestException, mixin, Type } from '@nestjs/common';
import { Observable } from 'rxjs';
import { FastifyRequest } from 'fastify';
import { writeFile } from 'fs/promises';
import { join, extname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { FastifyFile } from '../interfaces/fastify-file.interface';

export interface FastifyFilesInterceptorOptions {
  fieldName: string;
  maxCount?: number;
  fileFilter?: (req: any, file: any, cb: (error: Error | null, acceptFile: boolean) => void) => void;
  limits?: {
    fileSize?: number;
  };
}

export function FastifyFilesInterceptor(fieldName: string, maxCount = 10, options: Omit<FastifyFilesInterceptorOptions, 'fieldName' | 'maxCount'> = {}): Type<NestInterceptor> {
  @Injectable()
  class MixinInterceptor implements NestInterceptor {
    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
      const req = context.switchToHttp().getRequest<FastifyRequest>();

      if (!req.isMultipart()) {
        return next.handle();
      }

      const body = req.body as any;
      let filesPart = body?.[fieldName];

      if (!filesPart) {
         return next.handle();
      }

      // Normalize to array
      if (!Array.isArray(filesPart)) {
        filesPart = [filesPart];
      }

      if (filesPart.length > maxCount) {
         throw new BadRequestException('Too many files');
      }

      const files: FastifyFile[] = [];

      try {
        for (const filePart of filesPart) {
            // Filter
            if (options.fileFilter) {
               let error: Error | null = null;
               let accepted = true;
               options.fileFilter(req, filePart, (e, a) => {
                  error = e;
                  accepted = a;
               });

               if (error || !accepted) {
                  throw error || new BadRequestException('File type not allowed');
               }
            }

            const buffer = await filePart.toBuffer();

            if (options.limits?.fileSize && buffer.length > options.limits.fileSize) {
               throw new BadRequestException(`File ${filePart.filename} too large`);
            }

            const filename = `${randomBytes(16).toString('hex')}${extname(filePart.filename)}`;
            const filepath = join(tmpdir(), filename);

            await writeFile(filepath, buffer);

            files.push({
              fieldname: filePart.fieldname,
              originalname: filePart.filename,
              encoding: filePart.encoding,
              mimetype: filePart.mimetype,
              filename: filename,
              path: filepath,
              size: buffer.length,
            });
        }

        (req as any).files = files;
        delete body[fieldName];

      } catch (err) {
        throw new BadRequestException('File upload failed: ' + err.message);
      }

      return next.handle();
    }
  }

  return mixin(MixinInterceptor);
}
