import type { DigestRunRecord, DigestSourcePost, PostPushStateRecord } from "./types";

function nowIso(now = new Date()): string {
  return now.toISOString();
}

export async function insertDigestRun(
  db: D1Database,
  input: {
    id: string;
    source: string;
    candidateCount: number;
    itemCount: number;
    aiAnalysis: boolean;
    messageText: string;
    analysisText?: string;
    detailedReportUrl?: string;
    sourceItems: DigestSourcePost[];
    now?: Date;
  }
): Promise<void> {
  await db.prepare(`INSERT INTO digest_runs (
      id, created_at, source, candidate_count, item_count, ai_analysis, message_text, analysis_text, detailed_report_url, source_items_json, feishu_push_ok, push_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`)
    .bind(
      input.id,
      nowIso(input.now),
      input.source,
      input.candidateCount,
      input.itemCount,
      input.aiAnalysis ? 1 : 0,
      input.messageText,
      input.analysisText ?? null,
      input.detailedReportUrl ?? null,
      JSON.stringify(input.sourceItems)
    )
    .run();
}

export async function markDigestRunPushed(db: D1Database, id: string, success: boolean, error?: string): Promise<void> {
  await db.prepare("UPDATE digest_runs SET feishu_push_ok = ?, push_error = ? WHERE id = ?").bind(success ? 1 : 0, error ?? null, id).run();
}

export async function listRecentDigestRuns(db: D1Database, limit = 20): Promise<DigestRunRecord[]> {
  const rows = await db.prepare("SELECT * FROM digest_runs ORDER BY created_at DESC LIMIT ?").bind(limit).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    id: String(row.id),
    createdAt: String(row.created_at),
    source: String(row.source ?? ""),
    candidateCount: Number(row.candidate_count ?? 0),
    itemCount: Number(row.item_count ?? 0),
    aiAnalysis: Number(row.ai_analysis ?? 0) === 1,
    messageText: String(row.message_text ?? ""),
    analysisText: row.analysis_text ? String(row.analysis_text) : undefined,
    detailedReportUrl: row.detailed_report_url ? String(row.detailed_report_url) : undefined,
    sourceItemsJson: String(row.source_items_json ?? "[]"),
    feishuPushOk: Number(row.feishu_push_ok ?? 0) === 1,
    pushError: row.push_error ? String(row.push_error) : undefined
  }));
}

export async function getPostPushState(db: D1Database, postId: string): Promise<PostPushStateRecord | undefined> {
  const row = await db.prepare("SELECT * FROM post_push_state WHERE post_id = ?").bind(postId).first<Record<string, unknown>>();
  if (!row) return undefined;
  return {
    postId: String(row.post_id),
    canonicalUrl: String(row.canonical_url),
    lastTitle: String(row.last_title),
    lastSeenAt: String(row.last_seen_at),
    lastActiveAt: String(row.last_active_at),
    lastPushedAt: row.last_pushed_at ? String(row.last_pushed_at) : undefined,
    contentFingerprint: String(row.content_fingerprint),
    lastRunId: row.last_run_id ? String(row.last_run_id) : undefined
  };
}

export async function upsertPostPushState(db: D1Database, input: PostPushStateRecord): Promise<void> {
  await db.prepare(`INSERT INTO post_push_state (post_id, canonical_url, last_title, last_seen_at, last_active_at, last_pushed_at, content_fingerprint, last_run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id) DO UPDATE SET
        canonical_url = excluded.canonical_url,
        last_title = excluded.last_title,
        last_seen_at = excluded.last_seen_at,
        last_active_at = excluded.last_active_at,
        last_pushed_at = excluded.last_pushed_at,
        content_fingerprint = excluded.content_fingerprint,
        last_run_id = excluded.last_run_id`)
    .bind(
      input.postId,
      input.canonicalUrl,
      input.lastTitle,
      input.lastSeenAt,
      input.lastActiveAt,
      input.lastPushedAt ?? null,
      input.contentFingerprint,
      input.lastRunId ?? null
    )
    .run();
}
