import { DataSource } from 'typeorm';
import { Readable } from 'stream';
import { Organization } from '../organizations/entities/organization.entity';
import {
  StorageService,
  StoredFile,
  StoredFileStream,
  UploadableFile,
} from '../storage/storage.service';
import { DocumentNode, DocumentNodeKind } from './entities/document-node.entity';
import { DocumentsService } from './documents.service';

/**
 * The document repository.
 *
 * The screen behind it listed six files invented in the browser and its upload button uploaded
 * nothing. These tests are about the three things a repository has to get right: the tree is a
 * tree, a tenant sees only its own, and deleting a folder deletes the *objects* under it — an
 * orphaned object is a confidential file nobody can see and nobody can delete.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

/** Storage as a map, so the tests are about the tree and not about a filesystem. */
class FakeStorage extends StorageService {
  readonly objects = new Map<string, Buffer>();
  private sequence = 0;

  async upload(file: UploadableFile, subPath: string): Promise<StoredFile> {
    const storageKey = `${subPath}/${(this.sequence += 1)}-${file.fileName}`;
    this.objects.set(storageKey, file.buffer ?? Buffer.alloc(0));
    return {
      storageKey,
      url: `memory://${storageKey}`,
      fileSize: file.buffer?.length ?? 0,
      mimeType: file.mimeType,
    };
  }

  async getStream(storageKey: string): Promise<StoredFileStream> {
    const bytes = this.objects.get(storageKey);
    if (!bytes) throw new Error(`missing object ${storageKey}`);
    return { stream: Readable.from(bytes), fileSize: bytes.length, mimeType: 'application/pdf' };
  }

  async delete(storageKey: string): Promise<void> {
    this.objects.delete(storageKey);
  }

  async getUrl(storageKey: string): Promise<string> {
    return `memory://${storageKey}`;
  }
}

describeWithDb('document repository', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let documents: DocumentsService;
  let storage: FakeStorage;

  let organizationId: string;
  let otherOrganizationId: string;

  const ACTOR = '77777777-7777-4777-8777-777777777777';

  const file = (name: string, bytes = 'hello'): UploadableFile => ({
    fileName: name,
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();

    storage = new FakeStorage();
    documents = new DocumentsService(
      dataSource.getRepository(DocumentNode),
      storage,
      dataSource,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const repo = dataSource.getRepository(Organization);
    const make = async (prefix: string) =>
      (
        await repo.save(
          repo.create({
            legalName: `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timezone: 'America/Santo_Domingo',
          }),
        )
      ).id;
    organizationId = await make('DOC');
    otherOrganizationId = await make('OTHER');
    storage.objects.clear();
  });

  it('stores a file and records it where it was filed', async () => {
    const folder = await documents.createFolder({ name: 'Contratos' }, organizationId, ACTOR);
    const node = await documents.upload(file('Arrendamiento.pdf'), { parentId: folder.id }, organizationId, ACTOR);

    expect(node.kind).toBe(DocumentNodeKind.FILE);
    expect(node.parentId).toBe(folder.id);
    expect(node.fileSize).toBe(5);
    expect(storage.objects.size).toBe(1);

    const listing = await documents.list(organizationId, { parentId: folder.id });
    expect(listing.rows.map((row) => row.name)).toEqual(['Arrendamiento.pdf']);
  });

  it('refuses two things with the same name in one folder', async () => {
    await documents.upload(file('Acta.pdf'), {}, organizationId, ACTOR);

    // A path has to mean one thing.
    await expect(
      documents.upload(file('Acta.pdf'), {}, organizationId, ACTOR),
    ).rejects.toThrow();
    // And the object of the refused upload is not left behind.
    expect(storage.objects.size).toBe(1);
  });

  it('lets the same name exist in two different folders', async () => {
    const first = await documents.createFolder({ name: '2025' }, organizationId, ACTOR);
    const second = await documents.createFolder({ name: '2026' }, organizationId, ACTOR);

    await documents.upload(file('Balance.pdf'), { parentId: first.id }, organizationId, ACTOR);
    await expect(
      documents.upload(file('Balance.pdf'), { parentId: second.id }, organizationId, ACTOR),
    ).resolves.toBeTruthy();
  });

  it('never files into another tenant’s folder', async () => {
    const theirs = await documents.createFolder({ name: 'Ajeno' }, otherOrganizationId, ACTOR);

    // Not "forbidden": a folder that is not ours does not exist as far as we are concerned.
    await expect(
      documents.upload(file('Fuga.pdf'), { parentId: theirs.id }, organizationId, ACTOR),
    ).rejects.toThrow();
  });

  it('lists only the caller’s own tree', async () => {
    await documents.upload(file('Nuestro.pdf'), {}, organizationId, ACTOR);
    await documents.upload(file('Ajeno.pdf'), {}, otherOrganizationId, ACTOR);

    const listing = await documents.list(organizationId, {});
    expect(listing.rows.map((row) => row.name)).toEqual(['Nuestro.pdf']);
  });

  it('searches the whole tree, not only the folder in front of you', async () => {
    const folder = await documents.createFolder({ name: 'Legal' }, organizationId, ACTOR);
    const deeper = await documents.createFolder(
      { name: 'Arrendamientos', parentId: folder.id },
      organizationId,
      ACTOR,
    );
    await documents.upload(file('Contrato-2019.pdf'), { parentId: deeper.id }, organizationId, ACTOR);

    // "Find the lease I scanned years ago" is not a question about the folder you are standing in.
    const found = await documents.list(organizationId, { search: 'contrato' });
    expect(found.rows.map((row) => row.name)).toEqual(['Contrato-2019.pdf']);
  });

  it('gives the chain of folders down to a node, so a breadcrumb can be clicked', async () => {
    const legal = await documents.createFolder({ name: 'Legal' }, organizationId, ACTOR);
    const leases = await documents.createFolder({ name: 'Arrendamientos', parentId: legal.id }, organizationId, ACTOR);
    const node = await documents.upload(file('Contrato.pdf'), { parentId: leases.id }, organizationId, ACTOR);

    const trail = await documents.breadcrumb(node.id, organizationId);
    expect(trail.map((row) => row.name)).toEqual(['Legal', 'Arrendamientos', 'Contrato.pdf']);
  });

  it('refuses to move a folder inside its own subtree', async () => {
    const parent = await documents.createFolder({ name: 'Padre' }, organizationId, ACTOR);
    const child = await documents.createFolder({ name: 'Hijo', parentId: parent.id }, organizationId, ACTOR);

    // It and everything under it would become unreachable while still occupying storage.
    await expect(documents.move(parent.id, { parentId: child.id }, organizationId)).rejects.toThrow();
    await expect(documents.move(parent.id, { parentId: parent.id }, organizationId)).rejects.toThrow();
  });

  it('deletes the objects under a folder, not only its rows', async () => {
    const folder = await documents.createFolder({ name: 'Temporal' }, organizationId, ACTOR);
    const inner = await documents.createFolder({ name: 'Dentro', parentId: folder.id }, organizationId, ACTOR);
    await documents.upload(file('Uno.pdf'), { parentId: folder.id }, organizationId, ACTOR);
    await documents.upload(file('Dos.pdf'), { parentId: inner.id }, organizationId, ACTOR);
    expect(storage.objects.size).toBe(2);

    await documents.remove(folder.id, organizationId);

    // An orphaned object is a confidential file nobody can see and nobody can delete.
    expect(storage.objects.size).toBe(0);
    const listing = await documents.list(organizationId, {});
    expect(listing.rows).toEqual([]);
  });

  it('marks a file as a template, and lists the templates apart', async () => {
    await documents.upload(file('Contrato.pdf'), {}, organizationId, ACTOR);
    const letterhead = await documents.upload(file('Membrete.docx'), {}, organizationId, ACTOR);
    await documents.update(letterhead.id, { templateType: 'INVOICE' as never }, organizationId);

    const templates = await documents.list(organizationId, { templatesOnly: true });
    expect(templates.rows.map((row) => row.name)).toEqual(['Membrete.docx']);
  });

  it('refuses to call a folder a template', async () => {
    const folder = await documents.createFolder({ name: 'Modelos' }, organizationId, ACTOR);
    await expect(
      documents.update(folder.id, { templateType: 'INVOICE' as never }, organizationId),
    ).rejects.toThrow();
  });

  it('serves the bytes back', async () => {
    const node = await documents.upload(file('Nota.pdf', 'contenido'), {}, organizationId, ACTOR);
    const { file: stored } = await documents.stream(node.id, organizationId);
    expect(stored.fileSize).toBe('contenido'.length);
  });

  it('refuses to download a folder', async () => {
    const folder = await documents.createFolder({ name: 'Carpeta' }, organizationId, ACTOR);
    await expect(documents.stream(folder.id, organizationId)).rejects.toThrow();
  });
});
