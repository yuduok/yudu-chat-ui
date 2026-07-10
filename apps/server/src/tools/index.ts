import type { ToolDefinition } from "@yudu/shared";

export interface ToolContext {
  signal?: AbortSignal;
}

export type ToolHandler = (
  args: unknown,
  ctx: ToolContext,
) => Promise<{ content: string; isError?: boolean }>;

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
  defaultEnabled: boolean;
  isAvailable?: () => boolean;
}

const registry = new Map<string, RegisteredTool>();

export interface ToolRegistrationOptions {
  defaultEnabled?: boolean;
  isAvailable?: () => boolean;
}

export function registerTool(
  def: ToolDefinition,
  handler: ToolHandler,
  options: ToolRegistrationOptions = {},
): void {
  registry.set(def.name, {
    definition: def,
    handler,
    defaultEnabled: options.defaultEnabled ?? true,
    isAvailable: options.isAvailable,
  });
}

export function getTool(name: string): RegisteredTool | undefined {
  return registry.get(name);
}

export function listTools(opts: { defaultsOnly?: boolean } = {}): ToolDefinition[] {
  return Array.from(registry.values())
    .filter((tool) => !opts.defaultsOnly || tool.defaultEnabled)
    .filter((tool) => tool.isAvailable?.() ?? true)
    .map((tool) => tool.definition);
}

export function listRegisteredTools(): RegisteredTool[] {
  return Array.from(registry.values());
}

export async function runTool(
  name: string,
  args: unknown,
  ctx: ToolContext = {},
): Promise<{ content: string; isError?: boolean }> {
  const t = registry.get(name);
  if (!t) {
    return { content: `unknown tool: ${name}`, isError: true };
  }
  if (t.isAvailable && !t.isAvailable()) {
    return { content: `tool '${name}' is not enabled on this server`, isError: true };
  }
  try {
    const out = await t.handler(args, ctx);
    return out;
  } catch (err: any) {
    return {
      content: err?.message ?? String(err),
      isError: true,
    };
  }
}

export function clearTools(): void {
  registry.clear();
}
