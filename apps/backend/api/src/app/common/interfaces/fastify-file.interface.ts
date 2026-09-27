import { tmpdir } from 'os';
import { basename, dirname, resolve, sep } from 'path';

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

/** The name `FastifyFileInterceptor` gives a spooled upload: 16 random bytes and a sanitized extension. */
const SPOOLED_UPLOAD_NAME = /^[0-9a-f]{32}(\.[a-z0-9]{1,10})?$/;

/**
 * The on-disk path of an upload, but only if it is one the upload interceptor spooled itself.
 *
 * `FastifyFileInterceptor` never uses the client's file name as a path component, so a path it
 * produces is always `<tmpdir>/<random hex><ext>`. Everything downstream reads, copies and deletes
 * `file.path`; if a file object ever reached it by another route — a different interceptor, a
 * DTO spread, a test double promoted to production — those calls would read or unlink wherever it
 * pointed. So the path is re-checked where it is used: inside the temp directory and named as the
 * interceptor names it, or treated as absent. Fails closed.
 */
export function spooledUploadPath(file: Pick<FastifyFile, 'path'>): string | null {
  if (!file.path) return null;
  const root = resolve(tmpdir());
  const candidate = resolve(file.path);
  // Directly inside the temp dir — the interceptor never nests — and named as it names files.
  if (!candidate.startsWith(root + sep) || dirname(candidate) !== root) return null;
  if (!SPOOLED_UPLOAD_NAME.test(basename(candidate))) return null;
  return candidate;
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
    path: spooledUploadPath(file) ?? undefined,
  };
}
