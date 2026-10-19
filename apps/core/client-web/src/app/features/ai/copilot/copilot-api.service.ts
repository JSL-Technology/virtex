import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { readCsrfCookie } from '../../../core/auth/csrf-token';

export interface CopilotConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type CopilotProposalStatus = 'PROPOSED' | 'CONFIRMED' | 'REJECTED' | 'FAILED' | 'EXPIRED';

/** A draft the copilot prepared. Nothing exists in the ERP until the person confirms it. */
export interface CopilotProposal {
  id: string;
  tool: string;
  summary: string;
  preview: Record<string, unknown>;
  status: CopilotProposalStatus;
  /** The draft that was created, once confirmed. */
  result: { id: string; link: string; label: string } | null;
  error: string | null;
  createdAt?: string;
  decidedAt?: string | null;
}

export type CopilotChartType = 'line' | 'area' | 'column' | 'bar' | 'pie';

/** What a chart shows, read by the server from a tool's own result. */
export interface CopilotChartData {
  categories: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
  unit: string | null;
  omitted: number;
  drawnAt: string;
}

/** A chart the copilot drew. Pinned, it is drawn again from live data on the dashboard. */
export interface CopilotChart {
  id: string;
  title: string;
  type: CopilotChartType;
  sourceTool: string;
  /** Null when a pinned chart cannot be drawn now (see `unavailable`). */
  data: CopilotChartData | null;
  pinned: boolean;
  unavailable?: 'not_allowed' | 'failed';
  createdAt: string;
}

export interface CopilotEntry {
  seq: number;
  role: 'user' | 'assistant';
  text: string;
  /** The tools an answer consulted: where its figures came from. */
  toolsUsed: string[];
  proposals: string[];
  /** Charts drawn while writing this answer. */
  charts: string[];
}

export interface CopilotTranscript {
  conversation: CopilotConversation;
  entries: CopilotEntry[];
  proposals: CopilotProposal[];
  charts: CopilotChart[];
}

export interface CopilotCapability {
  name: string;
  kind: 'read' | 'draft';
}

export interface CopilotTurnResult {
  text: string;
  stopReason: string;
  toolsUsed: string[];
  proposals: string[];
}

/** What a turn streams back, in order. `done` and `error` end it. */
export type CopilotEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'proposal'; proposal: CopilotProposal }
  | { type: 'chart'; chart: CopilotChart }
  | { type: 'done'; result: CopilotTurnResult }
  | { type: 'error'; key: string; message: string };

/** A refusal before the stream started, carrying the server's localized message. */
export class CopilotRequestError extends Error {
  constructor(
    readonly status: number,
    readonly key: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The copilot's endpoints.
 *
 * Everything goes through `HttpClient` — and so through the auth interceptor — except sending a
 * message: its answer is a server-sent event stream that has to be read as it arrives, which
 * `HttpClient` cannot do. That one call uses `fetch`, and therefore does by hand what the
 * interceptor would: send the cookies, send the CSRF header, and on an expired session let the
 * interceptor renew it (through an ordinary call) before trying once more.
 */
@Injectable({ providedIn: 'root' })
export class CopilotApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/ai/copilot`;

  conversations(): Observable<CopilotConversation[]> {
    return this.http.get<CopilotConversation[]>(`${this.url}/conversations`);
  }

  capabilities(): Observable<CopilotCapability[]> {
    return this.http.get<CopilotCapability[]>(`${this.url}/capabilities`);
  }

  create(): Observable<CopilotConversation> {
    return this.http.post<CopilotConversation>(`${this.url}/conversations`, {});
  }

  transcript(id: string): Observable<CopilotTranscript> {
    return this.http.get<CopilotTranscript>(`${this.url}/conversations/${id}`);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/conversations/${id}`);
  }

  confirm(proposalId: string): Observable<CopilotProposal> {
    return this.http.post<CopilotProposal>(`${this.url}/proposals/${proposalId}/confirm`, {});
  }

  reject(proposalId: string): Observable<CopilotProposal> {
    return this.http.post<CopilotProposal>(`${this.url}/proposals/${proposalId}/reject`, {});
  }

  /** The person's pinned charts, each drawn now with their own permissions. */
  pinnedCharts(): Observable<CopilotChart[]> {
    return this.http.get<CopilotChart[]>(`${this.url}/charts/pinned`);
  }

  pin(chartId: string): Observable<CopilotChart> {
    return this.http.post<CopilotChart>(`${this.url}/charts/${chartId}/pin`, {});
  }

  unpin(chartId: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/charts/${chartId}/pin`);
  }

  /** Ask; the answer arrives as events. Unsubscribing stops reading (the turn still completes server-side). */
  send(conversationId: string, text: string): Observable<CopilotEvent> {
    return new Observable<CopilotEvent>((subscriber) => {
      const abort = new AbortController();
      const run = async () => {
        let response = await this.post(conversationId, text, abort.signal);
        if (response.status === 401) {
          // Renew the session the way every other call does, then try once more.
          await firstValueFrom(this.capabilities()).catch(() => undefined);
          response = await this.post(conversationId, text, abort.signal);
        }
        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => ({}) as Record<string, unknown>);
          throw new CopilotRequestError(
            response.status,
            String(body['messageKey'] ?? 'ai.provider_error'),
            String(body['message'] ?? ''),
          );
        }
        for await (const event of readEvents(response.body)) {
          subscriber.next(event);
          if (event.type === 'done' || event.type === 'error') break;
        }
        subscriber.complete();
      };
      run().catch((error) => {
        if (!abort.signal.aborted) subscriber.error(error);
      });
      return () => abort.abort();
    });
  }

  private post(conversationId: string, text: string, signal: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    const csrf = readCsrfCookie();
    if (csrf) headers['X-XSRF-TOKEN'] = csrf;
    return fetch(`${this.url}/conversations/${conversationId}/messages`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ text }),
      signal,
    });
  }
}

/** Server-sent events from a byte stream, one parsed event at a time. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<CopilotEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const event = parseEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) yield event;
        boundary = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseEvent(block: string): CopilotEvent | null {
  let name = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(data.join('\n'));
  } catch {
    return null;
  }
  switch (name) {
    case 'text':
      return { type: 'text', delta: String(payload['delta'] ?? '') };
    case 'tool':
      return { type: 'tool', name: String(payload['name'] ?? '') };
    case 'proposal':
      return {
        type: 'proposal',
        proposal: { ...(payload as unknown as CopilotProposal), status: 'PROPOSED', result: null, error: null },
      };
    case 'chart':
      return { type: 'chart', chart: payload as unknown as CopilotChart };
    case 'done':
      return { type: 'done', result: payload as unknown as CopilotTurnResult };
    case 'error':
      return { type: 'error', key: String(payload['key'] ?? 'ai.provider_error'), message: String(payload['message'] ?? '') };
    default:
      return null;
  }
}
