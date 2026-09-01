
export interface FastifyFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  filename: string;
  /** Present only when the interceptor was asked to persist the upload. */
  path?: string;
  size: number;
  /** The uploaded bytes, always present: the interceptor reads them to apply its own limits. */
  buffer?: Buffer;
}

/**
 * Adapt an uploaded file to the storage contract.
 *
 * The application serves on Fastify and its own `FastifyFileInterceptor` produces this shape, but
 * the storage layer was typed against ``Express.Multer.File`` — a framework this application does
 * not run. Every upload path therefore either cast or failed to compile. One conversion, named,
 * beats a cast at each call site.
 */
export function toUploadableFile(file: FastifyFile): {
  fileName: string;
  mimeType: string;
  buffer?: Buffer;
  path?: string;
} {
  return {
    fileName: file.originalname ?? file.filename,
    mimeType: file.mimetype,
    buffer: file.buffer,
    path: file.path,
  };
}
