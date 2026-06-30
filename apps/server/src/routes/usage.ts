import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { conversations, messages } from "../db/schema.js";
import type { UsageBucket, UsageReport } from "@yudu/shared";

function rowToBucket(r: {
  provider: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  messageCount: number;
}): UsageBucket {
  const p = Number(r.promptTokens ?? 0);
  const c = Number(r.completionTokens ?? 0);
  return {
    provider: r.provider,
    model: r.model,
    promptTokens: p,
    completionTokens: c,
    totalTokens: p + c,
    messageCount: Number(r.messageCount ?? 0),
  };
}

export async function usageRoutes(app: FastifyInstance) {
  // Aggregate token usage across the whole DB. Grouped by provider and
  // by provider+model. Token counts come from assistant messages only
  // (user / tool / system messages never carry usage on the server).
  app.get("/api/usage", async (): Promise<UsageReport> => {
    const rows = await db
      .select({
        provider: conversations.provider,
        model: conversations.model,
        promptTokens: sql<number | null>`SUM(CASE WHEN ${messages.role} = 'assistant' THEN ${messages.promptTokens} ELSE 0 END)`,
        completionTokens: sql<number | null>`SUM(CASE WHEN ${messages.role} = 'assistant' THEN ${messages.completionTokens} ELSE 0 END)`,
        messageCount: sql<number>`COUNT(${messages.id})`,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .groupBy(conversations.provider, conversations.model);

    const byModel = rows.map(rowToBucket);

    // Collapse to per-provider buckets.
    const providerMap = new Map<string, UsageBucket>();
    for (const b of byModel) {
      const cur = providerMap.get(b.provider);
      if (cur) {
        cur.promptTokens += b.promptTokens;
        cur.completionTokens += b.completionTokens;
        cur.totalTokens += b.totalTokens;
        cur.messageCount += b.messageCount;
      } else {
        providerMap.set(b.provider, { ...b });
      }
    }
    const byProvider = Array.from(providerMap.values());

    const total = byModel.reduce(
      (acc, b) => {
        acc.promptTokens += b.promptTokens;
        acc.completionTokens += b.completionTokens;
        acc.totalTokens += b.totalTokens;
        acc.messageCount += b.messageCount;
        return acc;
      },
      { promptTokens: 0, completionTokens: 0, totalTokens: 0, messageCount: 0 },
    );

    return {
      total,
      byProvider,
      byModel,
      generatedAt: new Date().toISOString(),
    };
  });
}
