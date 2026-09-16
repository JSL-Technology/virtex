import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type DocumentNodeKind = 'FOLDER' | 'FILE';
export type DocumentTemplateType = 'NONE' | 'INVOICE' | 'QUOTE' | 'EMAIL' | 'CONTRACT' | 'OTHER';

export interface DocumentNode {
  id: string;
  parentId: string | null;
  kind: DocumentNodeKind;
  name: string;
  mimeType: string | null;
  /** Bytes as stored. */
  fileSize: number;
  templateType: DocumentTemplateType;
  description: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentPage {
  rows: DocumentNode[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * The tenant's document repository.
 *
 * There was no service, because there was nothing to call: the repository screen's six rows were
 * literals in the browser bundle and its upload button uploaded nothing.
 */
@Injectable({ providedIn: 'root' })
export class DocumentsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/documents`;

  list(options: {
    parentId?: string | null;
    search?: string;
    templatesOnly?: boolean;
    templateType?: DocumentTemplateType;
  } = {}): Observable<DocumentPage> {
    let params = new HttpParams();
    if (options.parentId) params = params.set('parentId', options.parentId);
    if (options.search) params = params.set('search', options.search);
    if (options.templatesOnly) params = params.set('templatesOnly', 'true');
    if (options.templateType) params = params.set('templateType', options.templateType);
    return this.http.get<DocumentPage>(this.apiUrl, { params });
  }

  /** The chain of folders from the root down, so each level can be made clickable. */
  breadcrumb(id: string): Observable<DocumentNode[]> {
    return this.http.get<DocumentNode[]>(`${this.apiUrl}/${id}/breadcrumb`);
  }

  createFolder(name: string, parentId?: string | null): Observable<DocumentNode> {
    return this.http.post<DocumentNode>(`${this.apiUrl}/folders`, {
      name,
      parentId: parentId ?? undefined,
    });
  }

  upload(
    file: File,
    options: { parentId?: string | null; templateType?: DocumentTemplateType; description?: string } = {},
  ): Observable<DocumentNode> {
    const body = new FormData();
    body.append('file', file, file.name);
    if (options.parentId) body.append('parentId', options.parentId);
    if (options.templateType) body.append('templateType', options.templateType);
    if (options.description) body.append('description', options.description);
    return this.http.post<DocumentNode>(`${this.apiUrl}/upload`, body);
  }

  rename(id: string, name: string): Observable<DocumentNode> {
    return this.http.patch<DocumentNode>(`${this.apiUrl}/${id}/rename`, { name });
  }

  move(id: string, parentId: string | null): Observable<DocumentNode> {
    return this.http.patch<DocumentNode>(`${this.apiUrl}/${id}/move`, {
      parentId: parentId ?? undefined,
    });
  }

  update(
    id: string,
    body: { templateType?: DocumentTemplateType; description?: string },
  ): Observable<DocumentNode> {
    return this.http.patch<DocumentNode>(`${this.apiUrl}/${id}`, body);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  /**
   * The file itself.
   *
   * As a blob rather than by pointing a link at the URL: the download route is authenticated, and
   * a bare `<a href>` carries no Authorization header and no CSRF token.
   */
  download(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${id}/download`, { responseType: 'blob' });
  }
}
