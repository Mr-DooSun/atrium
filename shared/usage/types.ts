import { z } from "zod";

export const AccountIdentity = z.object({
  email: z.string().optional(),
  organization: z.string().optional(),
  subscriptionType: z.string().optional(),
});
export type AccountIdentity = z.infer<typeof AccountIdentity>;

export const RateLimitWindow = z.object({
  id: z.string(),
  kind: z.enum(["five_hour", "seven_day", "model_weekly", "custom"]),
  model: z.string().optional(),
  windowMinutes: z.number().int().positive().optional(),
  /** Codex reports zero after the last observed reset time has passed. */
  utilization: z.number().min(0),
  resetsAt: z.string().nullable(),
  limited: z.boolean(),
});
export type RateLimitWindow = z.infer<typeof RateLimitWindow>;

export const RateLimits = z.object({
  state: z.enum(["ok", "expired", "unauthenticated", "unavailable", "error"]),
  windows: z.array(RateLimitWindow),
  message: z.string().optional(),
  /** Actual quota observation time, retained across cached reads. */
  observedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  rejectedStatus: z.union([z.literal(401), z.literal(403)]).optional(),
});
export type RateLimits = z.infer<typeof RateLimits>;

export const TokenTotals = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative(),
  cacheReadInputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative().optional(),
});
export type TokenTotals = z.infer<typeof TokenTotals>;

export const LocalUsage = z.object({
  state: z.enum(["ok", "partial", "unavailable"]),
  fiveHour: TokenTotals,
  fiveHourStartsAt: z.string(),
  today: TokenTotals,
  sevenDay: TokenTotals,
});
export type LocalUsage = z.infer<typeof LocalUsage>;

export const WarningLevel = z.enum(["unknown", "ok", "warn", "critical", "limited"]);
export type WarningLevel = z.infer<typeof WarningLevel>;

export const AccountUsage = z.object({
  provider: z.enum(["claude", "codex"]),
  profileIds: z.array(z.string()).min(1),
  label: z.string(),
  configHome: z.string(),
  identity: AccountIdentity.optional(),
  rateLimits: RateLimits,
  local: LocalUsage,
  warningLevel: WarningLevel,
});
export type AccountUsage = z.infer<typeof AccountUsage>;

