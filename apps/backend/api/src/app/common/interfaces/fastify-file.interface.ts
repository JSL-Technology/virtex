
export interface FastifyFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  filename: string;
  path: string;
  size: number;
  buffer?: Buffer; // Optional, if we keep it in memory
}
