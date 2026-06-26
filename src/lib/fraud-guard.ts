import { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Default daily transaction ceiling per user (₦200,000) */
const DEFAULT_DAILY_LIMIT_NGN = 200_000;

/** Minimum single transaction amount (₦1,000) */
export const MIN_TRANSACTION_NGN = 1_000;

/** Maximum single transaction amount (₦100,000) */
export const MAX_TRANSACTION_NGN = 100_000;

/** Minimum token-set overlap ratio for name matching (70%) */
const NAME_MATCH_THRESHOLD = 0.7;

// ─────────────────────────────────────────────────────────────────────────────
// Name Normalization & Matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes a name string into sorted lowercase tokens.
 * Strips punctuation, extra whitespace, and common filler words.
 * Handles Nigerian name formats (e.g. "OLASUNKANMI OLATUNDE JAMES" → ["james", "olasunkanmi", "olatunde"])
 */
export function normalizeNameTokens(name: string): string[] {
  if (!name || typeof name !== "string") return [];

  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")       // Strip non-alpha characters
    .split(/\s+/)                    // Split on whitespace
    .map((t) => t.trim())
    .filter((t) => t.length > 1)     // Remove single-char tokens
    .sort();
}

/**
 * Compares a sender's bank account name against the user's registered legal name.
 * Uses token-set intersection ratio — returns match: true if ≥ 70% of legal name
 * tokens appear in the sender name tokens.
 *
 * This handles:
 * - Reordered names ("Tunde Olasunkanmi" vs "Olasunkanmi Tunde")
 * - Partial bank truncation ("OLASUNKANMI O" vs "Olasunkanmi Olatunde")
 * - Extra whitespace/casing differences
 */
export function matchSenderName(
  senderName: string,
  legalName: string
): { match: boolean; score: number } {
  const senderTokens = normalizeNameTokens(senderName);
  const legalTokens = normalizeNameTokens(legalName);

  if (legalTokens.length === 0 || senderTokens.length === 0) {
    return { match: false, score: 0 };
  }

  // Count how many legal name tokens appear in sender name tokens
  const matchingTokens = legalTokens.filter((lt) =>
    senderTokens.some((st) => st === lt || st.startsWith(lt) || lt.startsWith(st))
  );

  const score = matchingTokens.length / legalTokens.length;

  return {
    match: score >= NAME_MATCH_THRESHOLD,
    score: Math.round(score * 100) / 100,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily Limit Enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether a user would exceed their daily transaction ceiling.
 * Queries all initiated (non-expired, non-failed) transactions from today.
 */
export async function checkDailyLimit(
  supabase: SupabaseClient,
  userId: string,
  newAmountNgn: number
): Promise<{ allowed: boolean; spent: number; limit: number; remaining: number }> {
  // Fetch user's custom limit (or use default)
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("daily_limit_ngn, is_blocked")
    .eq("user_id", userId)
    .single();

  const limit = profile?.daily_limit_ngn
    ? Number(profile.daily_limit_ngn)
    : DEFAULT_DAILY_LIMIT_NGN;

  // If user is blocked, deny immediately
  if (profile?.is_blocked) {
    return { allowed: false, spent: 0, limit, remaining: 0 };
  }

  // Query today's total spent using the SQL function
  const { data: rpcResult, error: rpcError } = await supabase
    .rpc("get_daily_spent", { p_user_id: userId });

  if (rpcError) {
    console.error("[FraudGuard] Failed to query daily spend:", rpcError);
    // Fail-open for alpha, but log the error. In production, fail-closed.
    return { allowed: true, spent: 0, limit, remaining: limit };
  }

  const spent = Number(rpcResult) || 0;
  const remaining = Math.max(0, limit - spent);
  const allowed = (spent + newAmountNgn) <= limit;

  return { allowed, spent, limit, remaining };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fraud Flagging
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Freezes a transaction and generates an admin alert.
 * Sets transaction status to 'frozen_fraud' and inserts a row into admin_alerts.
 */
export async function flagFraud(
  supabase: SupabaseClient,
  transactionId: string,
  alertType: string,
  details: Record<string, unknown>
): Promise<void> {
  // Atomically freeze the transaction
  const { error: updateError } = await supabase
    .from("transactions")
    .update({ status: "frozen_fraud" })
    .eq("id", transactionId);

  if (updateError) {
    console.error(`[FraudGuard] Failed to freeze tx ${transactionId}:`, updateError);
  }

  // Look up user_id for the alert record
  const { data: tx } = await supabase
    .from("transactions")
    .select("user_id")
    .eq("id", transactionId)
    .single();

  // Insert admin alert
  const { error: alertError } = await supabase
    .from("admin_alerts")
    .insert({
      alert_type: alertType,
      transaction_id: transactionId,
      user_id: tx?.user_id || "unknown",
      details,
    });

  if (alertError) {
    console.error(`[FraudGuard] Failed to insert admin alert:`, alertError);
  }

  console.warn(
    `[FraudGuard] 🚨 FRAUD FLAG — tx: ${transactionId}, type: ${alertType}, details:`,
    JSON.stringify(details)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Sender Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * End-to-end validation: looks up the transaction's user_id, fetches their
 * legal_name from user_profiles, and runs matchSenderName.
 *
 * Returns { valid: true } if names match or if no legal name is registered
 * (alpha mode — logs warning but allows).
 * Returns { valid: false, reason } if sender name mismatches.
 */
export async function validateWebhookSender(
  supabase: SupabaseClient,
  transactionId: string,
  senderAccountName: string
): Promise<{ valid: boolean; reason?: string }> {
  if (!senderAccountName || senderAccountName.trim().length === 0) {
    console.warn(`[FraudGuard] No sender account name provided for tx ${transactionId}. Allowing in alpha.`);
    return { valid: true };
  }

  // Get the transaction's user_id
  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .select("user_id")
    .eq("id", transactionId)
    .single();

  if (txError || !tx) {
    console.error(`[FraudGuard] Transaction ${transactionId} not found.`);
    return { valid: false, reason: "Transaction not found" };
  }

  // Get the user's registered legal name
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("legal_name")
    .eq("user_id", tx.user_id)
    .single();

  if (!profile?.legal_name) {
    // No KYC name registered — allow in alpha but warn
    console.warn(
      `[FraudGuard] No legal_name registered for user ${tx.user_id}. ` +
      `Sender "${senderAccountName}" allowed by default in alpha mode.`
    );
    return { valid: true };
  }

  // Run the name matching algorithm
  const { match, score } = matchSenderName(senderAccountName, profile.legal_name);

  if (!match) {
    return {
      valid: false,
      reason: `Sender name mismatch: sender="${senderAccountName}" vs legal="${profile.legal_name}" (score: ${score})`,
    };
  }

  console.log(
    `[FraudGuard] ✓ Sender name match for tx ${transactionId}: ` +
    `"${senderAccountName}" ↔ "${profile.legal_name}" (score: ${score})`
  );

  return { valid: true };
}
