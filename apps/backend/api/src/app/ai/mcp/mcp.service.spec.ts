import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpPrincipal, McpService } from './mcp.service';
import { CopilotToolRegistry, s } from '../../contracts/copilot/copilot-tools.contract';

const user = { id: 'u-1', organizationId: 'org-1', permissions: ['accounts_receivable:view', 'ai_copilot:use'], language: 'es', branches: null };

function build() {
  const registry = new CopilotToolRegistry();
  const tools = [
    { kind: 'read', name: 'receivables_aging', description: 'Who owes the company.', branchScope: 'applied', permissions: [], inputSchema: s.object({}), run: async () => ({ total: 1500 }) },
    { kind: 'draft', name: 'draft_quote', description: 'Propose a quote.', branchScope: 'applied', permissions: [], inputSchema: s.object({ customer_id: s.string() }), propose: jest.fn(), commit: jest.fn() },
  ];
  registry.register(...(tools as never[]));
  const copilot = {
    externalTools: jest.fn(async () => tools),
    runExternal: jest.fn(async () => ({ total: 1500 })),
    proposeExternal: jest.fn(async () => ({ id: 'p-1', summary: 'Quote for Acme', preview: { total: 100 } })),
  };
  const audit = { recordRead: jest.fn() };
  const service = new McpService({} as never, copilot as never, {} as never, {} as never, audit as never, {} as never);
  return { service, copilot, audit };
}

async function connect(service: McpService, principal: McpPrincipal) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await service.server(principal, (id) => `https://app/ai/proposals/${id}`).connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  return client;
}

describe('McpService', () => {
  it('offers drafts only with the draft scope, and marks what only reads', async () => {
    const { service } = build();
    const reader = await connect(service, { user, scopes: ['erp:read'], clientId: 'c' });
    expect((await reader.listTools()).tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint])).toEqual([['receivables_aging', true]]);
    const drafter = await connect(service, { user, scopes: ['erp:read', 'erp:draft'], clientId: 'c' });
    const tools = (await drafter.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toEqual(['receivables_aging', 'draft_quote']);
    expect(tools[1].description).toContain('only PROPOSES');
  });

  it('reads as the person, audits the read as the agent\'s, and turns a draft into a proposal to confirm', async () => {
    const { service, copilot, audit } = build();
    const client = await connect(service, { user, scopes: ['erp:read', 'erp:draft'], clientId: 'claude' });
    const read = await client.callTool({ name: 'receivables_aging', arguments: {} });
    expect((read.content as Array<{ text: string }>)[0].text).toBe('{"total":1500}');
    expect(copilot.runExternal).toHaveBeenCalledWith(user, 'receivables_aging', {});
    expect(audit.recordRead).toHaveBeenCalledWith(expect.objectContaining({ entity: 'mcp_tool:receivables_aging', via: 'mcp:claude', userId: 'u-1' }));

    const draft = await client.callTool({ name: 'draft_quote', arguments: { customer_id: 'c-1' } });
    const body = JSON.parse((draft.content as Array<{ text: string }>)[0].text);
    expect(body).toMatchObject({ status: 'proposed', proposalId: 'p-1', confirmAt: 'https://app/ai/proposals/p-1' });
  });

  it('refuses a draft without the scope, and a tool the person does not have', async () => {
    const { service, copilot } = build();
    const client = await connect(service, { user, scopes: ['erp:read'], clientId: 'c' });
    expect((await client.callTool({ name: 'draft_quote', arguments: { customer_id: 'x' } })).isError).toBe(true);
    expect((await client.callTool({ name: 'payroll_totals', arguments: {} })).isError).toBe(true);
    expect(copilot.proposeExternal).not.toHaveBeenCalled();
  });

  it('answers a stateless JSON-RPC request over HTTP on Fastify', async () => {
    const { service } = build();
    const app = Fastify();
    app.post('/mcp', async (request, reply) => {
      const server = service.server({ user, scopes: ['erp:read'], clientId: 'c' }, (id) => id);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      reply.hijack();
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    });
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).result.tools.map((tool: { name: string }) => tool.name)).toEqual(['receivables_aging']);
    await app.close();
  });
});
