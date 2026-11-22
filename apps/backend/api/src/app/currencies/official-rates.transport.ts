import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

/** What a publisher answered: its status and its body, untouched. */
export interface PublisherResponse {
  status: number;
  body: string;
}

/**
 * The one way an official-rate feed reaches its publisher (FINB-03): a GET with a timeout, the body
 * kept as text for the feed's own parser to read.
 *
 * Its own class so that a test or a verifier replaces it with recorded publications and the network
 * is never touched — and so that whether this process may reach a publisher at all is decided by
 * the external-effects switch in the service, before this is called, and never here.
 */
@Injectable()
export class OfficialRatesTransport {
  constructor(private readonly http: HttpService) {}

  async get(url: string, headers: Readonly<Record<string, string>>): Promise<PublisherResponse> {
    const response = await firstValueFrom(
      this.http.get<string>(url, {
        // A generic agent name: nothing about the deployment or its customers goes to a third party.
        headers: { 'User-Agent': 'virtex-official-rates/1.0', ...headers },
        timeout: 20_000,
        responseType: 'text',
        transformResponse: (data: unknown) => data,
        maxContentLength: 5_000_000,
        // The status is the service's to judge, with the body it came with.
        validateStatus: () => true,
      }),
    );
    const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
    return { status: response.status, body };
  }
}
