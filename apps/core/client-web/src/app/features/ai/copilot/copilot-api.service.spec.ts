import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { parseEvent, readEvents } from './copilot-api.service';

// jsdom has no streams; Node's are the same WHATWG API that `fetch` hands the service.
const ReadableStream = NodeReadableStream as unknown as typeof globalThis.ReadableStream;

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('copilot event stream', () => {
  it('parses each event the server sends', () => {
    expect(parseEvent('event: text\ndata: {"delta":"Hola"}')).toEqual({ type: 'text', delta: 'Hola' });
    expect(parseEvent('event: tool\ndata: {"name":"receivables_aging"}')).toEqual({ type: 'tool', name: 'receivables_aging' });
    expect(parseEvent('event: error\ndata: {"key":"ai.unavailable","message":"No disponible"}')).toEqual({
      type: 'error',
      key: 'ai.unavailable',
      message: 'No disponible',
    });
    expect(parseEvent('event: proposal\ndata: {"id":"p1","tool":"draft_quote","summary":"s","preview":{}}')).toMatchObject({
      type: 'proposal',
      proposal: { id: 'p1', status: 'PROPOSED', result: null },
    });
  });

  it('ignores what it does not understand', () => {
    expect(parseEvent(': keep-alive')).toBeNull();
    expect(parseEvent('event: text\ndata: {broken')).toBeNull();
    expect(parseEvent('event: other\ndata: {}')).toBeNull();
  });

  it('reassembles events split across network chunks, including a split character', async () => {
    const bytes = 'event: text\ndata: {"delta":"año"}\n\n';
    const encoded = new TextEncoder().encode(bytes);
    const cut = bytes.indexOf('ñ') + 1; // inside the two-byte ñ
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, cut));
        controller.enqueue(encoded.slice(cut));
        controller.close();
      },
    });
    const events = [];
    for await (const event of readEvents(stream)) events.push(event);
    expect(events).toEqual([{ type: 'text', delta: 'año' }]);
  });

  it('reads several events in one chunk, in order', async () => {
    const events = [];
    for await (const event of readEvents(
      streamOf('event: tool\ndata: {"name":"a"}\n\nevent: text\ndata: {"delta":"x"}\n\nevent: done\ndata: {"text":"x","stopReason":"end_turn","toolsUsed":["a"],"proposals":[]}\n\n'),
    )) {
      events.push(event.type);
    }
    expect(events).toEqual(['tool', 'text', 'done']);
  });
});
