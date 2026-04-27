export interface Env {
  AI: Ai;
  RUNTIME_KV: KVNamespace;
  BRIEF_DB: D1Database;
  FEISHU_WEBHOOK: string;
  FEISHU_SECRET?: string;
  MANUAL_TRIGGER_TOKEN?: string;
  TGB_COOKIE?: string;
  TENCENT_COS_SECRET_ID: string;
  TENCENT_COS_SECRET_KEY: string;
  TENCENT_COS_BUCKET: string;
  TENCENT_COS_REGION: string;
  TENCENT_COS_BASE_URL?: string;
  WORKER_PUBLIC_BASE_URL?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  DIGEST_INTERVAL_HOURS?: string;
  HEARTBEAT_INTERVAL_HOURS?: string;
  REQUEST_TIMEOUT_MS?: string;
  FETCH_WINDOW_HOURS?: string;
  MAX_POSTS_PER_DIGEST?: string;
  MAX_REPLIES_PER_POST?: string;
  FAILURE_ALERT_THRESHOLD?: string;
  FAILURE_ALERT_COOLDOWN_MINUTES?: string;
  TGB_HOME_URL?: string;
  TGB_BBS_URL?: string;
}

export interface BriefConfig {
  feishuWebhook: string;
  feishuSecret: string;
  manualTriggerToken: string;
  tgbCookie: string;
  cosSecretId: string;
  cosSecretKey: string;
  cosBucket: string;
  cosRegion: string;
  cosBaseUrl: string;
  workerPublicBaseUrl: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  digestIntervalHours: number;
  heartbeatIntervalHours: number;
  requestTimeoutMs: number;
  fetchWindowHours: number;
  maxPostsPerDigest: number;
  maxRepliesPerPost: number;
  failureAlertThreshold: number;
  failureAlertCooldownMinutes: number;
  tgbHomeUrl: string;
  tgbBbsUrl: string;
}

export type PostSource = "home" | "bbs";

export interface PostCandidate {
  id: string;
  canonicalUrl: string;
  title: string;
  authorName: string;
  source: PostSource;
  sourceLabel: string;
  sourceRank: number;
  replyCount: number;
  publishedAt?: string;
  lastActiveAt: string;
}

export interface DigestSourcePost extends PostCandidate {
  headContent: string;
  sampledReplies: string[];
  mentionedTickers: string[];
  rawMetrics: Record<string, unknown>;
}

export interface TaogubaSnapshot {
  homeCandidates: PostCandidate[];
  bbsCandidates: PostCandidate[];
  items: PostCandidate[];
}

export interface RuntimeState {
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastHeartbeatAt?: string;
  lastAlertAt?: string;
  lastError?: string;
  consecutiveFailures: number;
}

export interface LLMAnalysisResult {
  analysis: string;
  modelLabel: string;
}

export interface DigestRunRecord {
  id: string;
  createdAt: string;
  source: string;
  candidateCount: number;
  itemCount: number;
  aiAnalysis: boolean;
  messageText: string;
  analysisText?: string;
  detailedReportUrl?: string;
  sourceItemsJson: string;
  feishuPushOk: boolean;
  pushError?: string;
}

export interface PostPushStateRecord {
  postId: string;
  canonicalUrl: string;
  lastTitle: string;
  lastSeenAt: string;
  lastActiveAt: string;
  lastPushedAt?: string;
  contentFingerprint: string;
  lastRunId?: string;
}
