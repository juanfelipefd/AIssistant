import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { gte, sql } from "drizzle-orm";

import { withDb } from "@/db";
import { tokenUsage } from "@/db/schema";

// The single gateway for model calls. NOTHING else in the codebase may import
// @anthropic-ai/sdk — every call goes through callModel() so that every call
// is budget-checked before it happens and metered after it does.

// ---------------------------------------------------------------------------
// RATES — USD per million tokens.
//
// MANUAL UPDATE REQUIRED whenever Anthropic changes pricing. These numbers
// are not fetched from anywhere. Last checked: 2026-11-14.
//
// Only token counts are stored (token_usage); cost is always derived from
// this table at read time, so correcting a rate here retroactively corrects
// every month-to-date figure. Keep retired models in the table as long as
// their rows fall inside the current month — a row whose model has no rate
// makes the spend unknowable, and callModel() refuses to run.
//
// Known simplification: Haiku 5.5 is priced higher above 100K input tokens
// per request ($0.50 / $2.50); the flat base rate is used here.
// ---------------------------------------------------------------------------
export const RATES = {
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5 },
} as const satisfies Record<
  string,
  { inputPerMTok: number; outputPerMTok: number }
>;

export type ModelId = keyof typeof RATES;

export class BudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly budgetUsd: number,
  ) {
    super(
      `Monthly model budget reached: $${spentUsd.toFixed(4)} spent of ` +
        `$${budgetUsd.toFixed(4)} (MONTHLY_BUDGET_USD). Call not attempted.`,
    );
    this.name = "BudgetExceededError";
  }
}

export interface MonthToDateUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// Created on first call, so importing this module (e.g. to read usage)
// never requires API credentials.
let client: Anthropic | undefined;

function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

function getBudgetUsd(): number {
  // Fails closed: with no valid budget there is no cap, so no call is made.
  const raw = process.env.MONTHLY_BUDGET_USD;
  const budget = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error(
      `MONTHLY_BUDGET_USD must be set to a non-negative number (got ${JSON.stringify(raw)}).`,
    );
  }
  return budget;
}

function costUsd(model: string, inputTokens: number, outputTokens: number) {
  const rate = RATES[model as ModelId];
  if (!rate) {
    throw new Error(
      `No rate for model "${model}" in RATES (src/lib/ai.ts); month-to-date spend cannot be computed.`,
    );
  }
  return (
    (inputTokens * rate.inputPerMTok + outputTokens * rate.outputPerMTok) /
    1_000_000
  );
}

/**
 * Tokens and estimated cost for the current calendar month (UTC, as computed
 * by the database's now()).
 */
export async function getMonthToDateUsage(): Promise<MonthToDateUsage> {
  const rows = await withDb((db) =>
    db
      .select({
        model: tokenUsage.model,
        inputTokens: sql<number>`coalesce(sum(${tokenUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${tokenUsage.outputTokens}), 0)::int`,
        cacheTokens: sql<number>`coalesce(sum(coalesce(${tokenUsage.cacheCreationInputTokens}, 0) + coalesce(${tokenUsage.cacheReadInputTokens}, 0)), 0)::int`,
      })
      .from(tokenUsage)
      .where(gte(tokenUsage.createdAt, sql`date_trunc('month', now())`))
      .groupBy(tokenUsage.model),
  );

  const usage: MonthToDateUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  for (const row of rows) {
    // RATES has no cache prices yet. Rather than silently undercount once
    // prompt caching is enabled, refuse to compute spend until it does.
    if (row.cacheTokens > 0) {
      throw new Error(
        `token_usage has prompt-cache tokens for "${row.model}" but RATES (src/lib/ai.ts) has no cache prices; add them before enabling caching.`,
      );
    }
    usage.inputTokens += row.inputTokens;
    usage.outputTokens += row.outputTokens;
    usage.costUsd += costUsd(row.model, row.inputTokens, row.outputTokens);
  }
  return usage;
}

/**
 * Makes one model call. Refuses (BudgetExceededError, no API request) when
 * month-to-date spend has reached MONTHLY_BUDGET_USD; otherwise calls the
 * API and logs the call's token counts to token_usage.
 *
 * `purpose` labels the call, e.g. 'session_chat', 'track_create', 'ranking'.
 * `sessionId` is null for calls that don't belong to a session.
 */
export async function callModel(
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, "model"> & {
    model: ModelId;
  },
  meta: { purpose: string; sessionId?: string | null },
): Promise<Anthropic.Message> {
  const budgetUsd = getBudgetUsd();
  const { costUsd: spentUsd } = await getMonthToDateUsage();
  if (spentUsd >= budgetUsd) {
    throw new BudgetExceededError(spentUsd, budgetUsd);
  }

  const response = await getClient().messages.create(params);

  // input_tokens excludes prompt-cache writes/reads; those are stored in
  // their own columns, as the API reports them. A separate short-lived
  // connection from the budget check — none is held open during the model
  // call, which can take minutes.
  await withDb((db) =>
    db.insert(tokenUsage).values({
      sessionId: meta.sessionId ?? null,
      model: params.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens,
      purpose: meta.purpose,
    }),
  );

  return response;
}
