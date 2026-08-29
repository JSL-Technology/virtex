import { Readable } from 'stream';

/** What a caller hands to storage. Deliberately not `Express.Multer.File`: see below. */
export interface UploadableFile {
  /** Original name as the user knows it; used for the extension and for display. */
  fileName: string;
  mimeType: string;
  /** The bytes, when the upload was buffered in memory. */
  buffer?: Buffer;
  /** A path on disk, when the upload was streamed to a temporary file. */
  path?: string;
}

/** What storage hands back. */
export interface StoredFile {
  /** Opaque key that identifies the object; the only thing callers should persist. */
  storageKey: string;
  /** A URL a browser can fetch. For private backends this is time-limited. */
  url: string;
  /** Size in bytes, as stored. */
  fileSize: number;
  mimeType: string;
}

export interface StoredFileStream {
  stream: Readable;
  fileSize: number;
  mimeType: string;
}

/**
 * File storage, as the application actually uses it.
 *
 * The previous contract was three methods — `upload(file): Promise<string>`, `delete`, `getUrl` —
 * and the callers had outgrown it without anyone updating it. Journal-entry attachments called
 * `storageService.getStream(key)`, which did not exist, and read `storedFile.storageKey` and
 * `.fileSize` off a return value that was a plain `string`. Audit adjustments did the same. So
 * uploading an attachment stored `undefined` for its key and size, and downloading one threw
 * `storageService.getStream is not a function`. The webpack build transpiles without type
 * checking, which is why none of it ever failed to compile.
 *
 * The parameter type is `UploadableFile`, not `Express.Multer.File`. The application serves on
 * Fastify and its own `FastifyFileInterceptor` produces a different shape, so typing the contract
 * to Multer described a framework this application does not run.
 */
export abstract class StorageService {
  /**
   * Store a file under `subPath` and return everything the caller needs to record it.
   *
   * `subPath` groups objects by tenant or by domain. The S3 strategy used to ignore it entirely
   * and write every object — attachments, audit evidence, avatars — under `avatars/`.
   */
  abstract upload(file: UploadableFile, subPath: string): Promise<StoredFile>;

  /** Read an object back. Used to serve attachments without proxying through memory. */
  abstract getStream(storageKey: string): Promise<StoredFileStream>;

  abstract delete(storageKey: string): Promise<void>;

  /**
   * A URL for the object. Time-limited where the backend is private, which is why it is async:
   * signing is an operation, not a string concatenation.
   */
  abstract getUrl(storageKey: string): Promise<string>;
}
