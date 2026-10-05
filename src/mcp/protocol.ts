// ============================================================================
// Shared MCP JSON-RPC 2.0 handler (transport-agnostic). Used by both the stdio
// and the Streamable HTTP transports so there is a SINGLE toolset and a single
// safety model for every client (Claude, ChatGPT, …).
// ============================================================================
import { TOOLS, TOOLS_BY_NAME } from './tools.js';
import { RESOURCES, RESOURCES_BY_URI, PROMPTS, PROMPTS_BY_NAME } from './resources.js';
import type { DankoCore } from './core.js';

export const PROTOCOL_VERSION = '2025-06-18';
export const SERVER_INFO = { name: 'danko-music-converter', version: '1.0.0' };

const READ_ONLY = new Set(TOOLS.filter((t) => t.readOnly).map((t) => t.name));

export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
}

export class McpHandler {
  constructor(private core: DankoCore) {}

  private listTools() {
    return {
      tools: TOOLS.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: { readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive },
        ...((process.env.DANKO_MCP_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL) ? {
          securitySchemes: [{ type: 'oauth2', scopes: ['danko:tools'] }],
        } : {}),
        ...(t.uiTemplate ? { _meta: { 'openai/outputTemplate': t.uiTemplate } } : {}),
      })),
    };
  }

  private listResources() {
    return { resources: RESOURCES.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType })) };
  }

  private readResource(params: Record<string, unknown> | undefined) {
    const uri = String(params?.uri ?? '');
    const r = RESOURCES_BY_URI[uri];
    if (!r) return { error: { code: -32602, message: `Unknown resource: ${uri}` } };
    return { result: { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text }] } };
  }

  private listPrompts() {
    return { prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args ?? [] })) };
  }

  private getPrompt(params: Record<string, unknown> | undefined) {
    const name = String(params?.name ?? '');
    const p = PROMPTS_BY_NAME[name];
    if (!p) return { error: { code: -32602, message: `Unknown prompt: ${name}` } };
    const args = (params?.arguments ?? {}) as Record<string, string>;
    return { result: { description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.render(args) } }] } };
  }

  private async callTool(params: Record<string, unknown> | undefined) {
    const name = String(params?.name ?? '');
    const args = (params?.arguments ?? {}) as Record<string, unknown>;
    const tool = TOOLS_BY_NAME[name];
    if (!tool) return { error: { code: -32602, message: `Unknown tool: ${name}` } };

    // Safety gate: destructive tools require explicit confirmation.
    if (tool.destructive && args.confirm !== true) {
      return {
        result: {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({
            ok: false, reason: 'confirmation-required',
            message: `"${name}" is a ${name === 'update_metadata' ? 'protected' : 'destructive'} operation. Re-call with "confirm": true to proceed.`,
          }) }],
        },
      };
    }

    let res;
    try {
      res = await (this.core as unknown as Record<string, (x: Record<string, unknown>) => Promise<unknown>>)[tool.handler](args);
    } catch (e) {
      res = { ok: false, reason: 'core-error', message: String((e as Error)?.message ?? e) };
    }
    const ok = (res as { ok?: boolean })?.ok !== false;
    return {
      result: {
        isError: !ok,
        structuredContent: res,
        content: [{ type: 'text', text: JSON.stringify(res) }],
      },
    };
  }

  /** Returns a JSON-RPC response object, or null for notifications. */
  async handle(msg: JsonRpcMessage): Promise<object | null> {
    const { id, method, params } = msg;
    const reply = (payload: object) => ({ jsonrpc: '2.0', id, ...payload });

    switch (method) {
      case 'initialize':
        return reply({ result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false, subscribe: false },
            prompts: { listChanged: false },
          },
          serverInfo: SERVER_INFO,
          instructions: 'Danko Music Converter MCP. Scoped audio/library tools only; destructive tools need confirm:true.',
        } });
      case 'notifications/initialized':
        return null;
      case 'ping':
        return reply({ result: {} });
      case 'tools/list':
        return reply({ result: this.listTools() });
      case 'tools/call': {
        const out = await this.callTool(params);
        return reply(out);
      }
      case 'resources/list':
        return reply({ result: this.listResources() });
      case 'resources/read':
        return reply(this.readResource(params));
      case 'prompts/list':
        return reply({ result: this.listPrompts() });
      case 'prompts/get':
        return reply(this.getPrompt(params));
      default:
        if (id === undefined) return null;
        return reply({ error: { code: -32601, message: `Method not found: ${method}` } });
    }
  }

  get readOnlyTools(): Set<string> { return READ_ONLY; }
}
