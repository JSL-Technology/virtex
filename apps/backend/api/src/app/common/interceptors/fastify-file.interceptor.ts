
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, BadRequestException, mixin, Type } from '@nestjs/common';
import { Observable } from 'rxjs';
import { FastifyRequest } from 'fastify';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { writeFile } from 'fs/promises';
import { join, extname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { FastifyFile } from '../interfaces/fastify-file.interface';

export interface FastifyFileInterceptorOptions {
  fieldName: string;
  fileFilter?: (req: any, file: any, cb: (error: Error | null, acceptFile: boolean) => void) => void;
  limits?: {
    fileSize?: number;
  };
  /**
   * Also write the upload to a temporary file.
   *
   * Off by default. The interceptor already holds the bytes in memory, and writing them to
   * `os.tmpdir()` creates a window in which the content exists unencrypted on a shared filesystem.
   * For a DGII signing certificate — a PKCS#12 containing the tenant's private key — that window is
   * a real exposure, and the file survives a crash between the write and the handler's cleanup.
   * Only a handler that genuinely needs a path (a streaming parser, an external tool) should ask.
   */
  persistToDisk?: boolean;
  /** Accepted MIME types. An upload of any other type is refused before it is read. */
  allowedMimeTypes?: readonly string[];
}

export function FastifyFileInterceptor(fieldName: string, options: Omit<FastifyFileInterceptorOptions, 'fieldName'> = {}): Type<NestInterceptor> {
  @Injectable()
  class MixinInterceptor implements NestInterceptor {
    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
      const req = context.switchToHttp().getRequest<FastifyRequest>();

      if (!req.isMultipart()) {
        return next.handle();
      }

      // With attachFieldsToBody: true, the file is in req.body[fieldName]
      const body = req.body as any;
      const filePart = body?.[fieldName];

      if (!filePart) {
         // Should we throw? If the endpoint expects a file, usually yes.
         // But NestJS FileInterceptor allows optional files sometimes.
         // Let's strictly check if it's there only if we are sure.
         // But for now, if it's missing, we just proceed.
         return next.handle();
      }

      // fastify-multipart with attachFieldsToBody: true returns an object for file:
      // {
      //   type: 'file',
      //   toBuffer: [Function: toBuffer],
      //   filename: '...',
      //   encoding: '...',
      //   mimetype: '...',
      //   fieldname: '...'
      // }
      // OR if it's an array of files, it returns an array.

      if (Array.isArray(filePart)) {
         throw new BadRequestException('Single file expected');
      }

      try {
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

        if (
          options.allowedMimeTypes &&
          options.allowedMimeTypes.length > 0 &&
          !options.allowedMimeTypes.includes(filePart.mimetype)
        ) {
          throw new BadRequestException(
            `Tipo de archivo no permitido (${filePart.mimetype}).`,
          );
        }

        const buffer = await filePart.toBuffer();

        if (options.limits?.fileSize && buffer.length > options.limits.fileSize) {
           throw new BadRequestException('File too large');
        }

        // The original file name is never used as a path component: `extname` of attacker-supplied
        // text is attacker-supplied text.
        const extension = sanitizeExtension(extname(filePart.filename ?? ''));
        const filename = `${randomBytes(16).toString('hex')}${extension}`;

        let filepath: string | undefined;
        if (options.persistToDisk) {
          filepath = join(tmpdir(), filename);
          // 0600: readable only by the process owner, for the window it exists.
          await writeFile(filepath, buffer, { mode: 0o600 });
        }

        const fileObject: FastifyFile = {
          fieldname: filePart.fieldname,
          originalname: filePart.filename,
          encoding: filePart.encoding,
          mimetype: filePart.mimetype,
          filename: filename,
          path: filepath,
          size: buffer.length,
          buffer,
        };

        // Assign to req.file for decorators
        (req as any).file = fileObject;

        // IMPORTANT: Clean up req.body so DTO validation doesn't fail on the file field?
        // Usually we want the file field to be there if the DTO expects it, or removed if it doesn't.
        // NestJS FileInterceptor removes it from body.
        delete body[fieldName];

      } catch (err) {
        throw new BadRequestException('File upload failed: ' + (err as Error).message);
      }

      return next.handle();
    }
  }

  return mixin(MixinInterceptor);
}

/** Only a short, alphanumeric extension survives; anything else is dropped. */
function sanitizeExtension(extension: string): string {
  return /^\.[A-Za-z0-9]{1,10}$/.test(extension) ? extension.toLowerCase() : '';
}
