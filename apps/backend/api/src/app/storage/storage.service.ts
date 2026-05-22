
export abstract class StorageService {
  abstract upload(file: Express.Multer.File, subPath: string): Promise<string>;
  abstract delete(path: string): Promise<void>;
  abstract getUrl(path: string): string;
}
