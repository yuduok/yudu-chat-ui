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
  // Aggregate token usage across the whole DB. Two views: per-provider
  // (collapsed on provider) and per-model (collapsed on model name — so
  // e.g. `gpt-4o` used through OpenAI and Azure appears once). Token
  // counts come from assistant messages only.
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

    const perRow = rows.map(rowToBucket);

    // ---- per-provider ----
    const providerMap = new Map<string, UsageBucket>();
    for (const b of perRow) {
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

    // ---- per-model (collapse rows with the same model name) ----
    // `providers` is collected into a Set during accumulation so we
    // de-duplicate naturally; we only materialize a string[] when
    // emitting the wire shape (and only when there's more than one).
    const modelMap = new Map<string, { bucket: UsageBucket; providers: Set<string> }>();
    for (const b of perRow) {
      const cur = modelMap.get(b.model);
      if (cur) {
        cur.bucket.promptTokens += b.promptTokens;
        cur.bucket.completionTokens += b.completionTokens;
        cur.bucket.totalTokens += b.totalTokens;
        cur.bucket.messageCount += b.messageCount;
        cur.providers.add(b.provider);
      } else {
        modelMap.set(b.model, { bucket: { ...b }, providers: new Set([b.provider]) });
      }
    }
    const byModel = Array.from(modelMap.values()).map((entry) => {
      const providers = Array.from(entry.providers).sort();
      // When the same model came from multiple providers we surface
      // that explicitly; for single-provider buckets the field is
      // omitted to keep the wire shape quiet.
      const out: UsageBucket = {
        provider: entry.bucket.provider,
        model: entry.bucket.model,
        promptTokens: entry.bucket.promptTokens,
        completionTokens: entry.bucket.completionTokens,
        totalTokens: entry.bucket.totalTokens,
        messageCount: entry.bucket.messageCount,
      };
      if (providers.length > 1) out.providers = providers;
      return out;
    });

    const total = perRow.reduce(
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
      byProvider: Array.from(providerMap.values()),
      byModel,
      generatedAt: new Date().toISOString(),
    };
  });
}
