import type { ToolDefinition } from "@yudu/shared";
import type { ToolHandler } from "./index.js";

const def: ToolDefinition = {
  name: "web_search",
  description: "Search the public web through Tavily and return concise results with source URLs.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query." },
      max_results: { type: "integer", description: "Number of results (default 5, max 10)." },
      topic: { type: "string", enum: ["general", "news"], description: "Search category." },
    },
    required: ["query"],
  },
};

const handler: ToolHandler = async (args, ctx) => {
  const input = args as { query?: unknown; max_results?: unknown; topic?: unknown };
  if (typeof input?.query !== "string" || !input.query.trim()) {
    return { content: "missing 'query' argument", isError: true };
  }
  const maxResults = Number.isInteger(input.max_results)
    ? Math.min(10, Math.max(1, Number(input.max_results)))
    : 5;
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.YUDU_TAVILY_API_KEY,
      query: input.query,
      topic: input.topic === "news" ? "news" : "general",
      max_results: maxResults,
      search_depth: "basic",
      include_answer: false,
    }),
    signal: ctx.signal,
  });
  if (!response.ok) return { content: `Tavily search failed (${response.status})`, isError: true };
  const payload = await response.json() as {
    results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
  };
  const results = payload.results ?? [];
  return {
    content: results.map((result, index) =>
      `[${index + 1}] ${result.title || "Untitled"}\n${result.url || ""}\n${(result.content || "").slice(0, 1200)}`,
    ).join("\n\n") || "no results",
  };
};

export const web_search = {
  def,
  handler,
  isAvailable: () => Boolean(process.env.YUDU_TAVILY_API_KEY),
};
