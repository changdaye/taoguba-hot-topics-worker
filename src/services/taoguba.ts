import type { BriefConfig, DigestSourcePost, PostCandidate, PostPushStateRecord, TaogubaSnapshot } from "../types";
import { stripHtml, truncate } from "../lib/value";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const REPUSH_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export async function fetchTaogubaSnapshot(config: BriefConfig, now = new Date()): Promise<TaogubaSnapshot> {
  const [homeHtml, bbsHtml] = await Promise.all([
    fetchText(config.tgbHomeUrl, config),
    fetchText(config.tgbBbsUrl, config)
  ]);

  const homeCandidates = parseHomeListPage(homeHtml, now);
  const bbsCandidates = parseBbsListPage(bbsHtml, now);
  const items = dedupeCandidates([...homeCandidates, ...bbsCandidates]);
  return { homeCandidates, bbsCandidates, items };
}

export async function fetchPostDetails(config: BriefConfig, candidates: PostCandidate[], now = new Date()): Promise<DigestSourcePost[]> {
  const details = await Promise.all(candidates.map(async (candidate) => {
    try {
      const html = await fetchText(candidate.canonicalUrl, config);
      return parseDetailPage(candidate.canonicalUrl, html, now, candidate);
    } catch (error) {
      console.error("Taoguba detail fetch failed", candidate.canonicalUrl, error instanceof Error ? error.message : String(error));
      return {
        ...candidate,
        headContent: candidate.title,
        sampledReplies: [],
        mentionedTickers: extractTickers(candidate.title),
        rawMetrics: { degraded: true }
      } satisfies DigestSourcePost;
    }
  }));

  return details;
}

export function parseHomeListPage(html: string, now = new Date()): PostCandidate[] {
  const candidates = parseLinkedTitleBlocks(html, now, "home", "首页推荐");
  if (candidates.length > 0) return candidates;
  return [];
}

export function parseBbsListPage(html: string, now = new Date()): PostCandidate[] {
  const starts = Array.from(html.matchAll(/<div class="Nbbs-tiezi-lists">/g));
  const segments = starts.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = starts[index + 1]?.index ?? html.length;
    return html.slice(start, end);
  });
  return segments
    .map((segment, index) => parseBbsCandidate(segment, index, now))
    .filter((item): item is PostCandidate => Boolean(item));
}

export function parseDetailPage(url: string, html: string, now = new Date(), seed?: PostCandidate): DigestSourcePost {
  const title = seed?.title ?? stripMaybe(extractFirst(html, /<title>([\s\S]*?)<\/title>/))?.split("_")[0] ?? "未命名帖子";
  const authorName = seed?.authorName ?? stripMaybe(extractFirst(html, /<title>[\s\S]*?_([^_]+?)_\s*淘股吧<\/title>/)) ?? "未知作者";
  const headContent = parseHeadContent(html) || seed?.title || "";
  const sampledReplies = parseReplies(html);
  const lastActiveAt = seed?.lastActiveAt ?? now.toISOString();
  const publishedAt = seed?.publishedAt ?? lastActiveAt;
  const source = seed?.source ?? "bbs";
  const sourceLabel = seed?.sourceLabel ?? (source === "home" ? "首页推荐" : "论坛主列表");
  const sourceRank = seed?.sourceRank ?? 1;
  const replyCount = seed?.replyCount ?? sampledReplies.length;
  const mentionedTickers = extractTickers([title, headContent, ...sampledReplies].join("\n"));

  return {
    id: seed?.id ?? normalizeTopicId(url),
    canonicalUrl: normalizeTopicUrl(url),
    title,
    authorName,
    source,
    sourceLabel,
    sourceRank,
    replyCount,
    publishedAt,
    lastActiveAt,
    headContent: truncate(headContent, 1200),
    sampledReplies: sampledReplies.slice(0, 8),
    mentionedTickers,
    rawMetrics: {
      parsedAt: now.toISOString(),
      replyCount: sampledReplies.length
    }
  };
}

export function pickPostsForDigest(candidates: PostCandidate[], limit: number): PostCandidate[] {
  return dedupeCandidates(candidates)
    .sort((left, right) => scoreCandidate(right) - scoreCandidate(left) || right.lastActiveAt.localeCompare(left.lastActiveAt))
    .slice(0, limit);
}

export function buildPostFingerprint(input: { title: string; headContent: string; sampledReplies: string[]; lastActiveAt: string }): string {
  const canonical = [input.title, input.headContent, ...input.sampledReplies, input.lastActiveAt]
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
  return simpleHash(canonical);
}

export function shouldRepushPost(previous: Pick<PostPushStateRecord, "contentFingerprint" | "lastPushedAt"> | undefined, current: Pick<PostPushStateRecord, "contentFingerprint">, now = new Date()): boolean {
  if (!previous) return true;
  if (previous.contentFingerprint !== current.contentFingerprint) return true;
  if (!previous.lastPushedAt) return true;
  const lastPushedAt = Date.parse(previous.lastPushedAt);
  if (Number.isNaN(lastPushedAt)) return true;
  return now.getTime() >= lastPushedAt + REPUSH_COOLDOWN_MS;
}

export function normalizeTopicUrl(input: string): string {
  const resolved = input.startsWith("http") ? input : `https://www.tgb.cn/${input.replace(/^\/+/, "")}`;
  const url = new URL(resolved);
  const match = url.pathname.match(/\/(a\/[^/\-]+)(?:-\d+)?$/);
  if (match) {
    return `${url.origin}/${match[1]}-1`;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function parseBbsCandidate(segment: string, index: number, now: Date): PostCandidate | undefined {
  const href = extractFirst(segment, /href="(a\/[^"]+)"/);
  const title = stripMaybe(extractFirst(segment, /title=['"]([^'"]+)['"]/)) ?? stripMaybe(extractFirst(segment, /<a[^>]*>([\s\S]*?)<\/a>/));
  if (!href || !title) return undefined;
  const authorName = stripMaybe(extractFirst(segment, /<div class="left middle-list-user[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)) ?? "未知作者";
  const talk = extractFirst(segment, /<div class="left middle-list-talk[\s\S]*?>([^<]+)<\/div>/) ?? "0 / 0";
  const [replyCountText] = talk.split("/").map((part) => part.trim());
  const lastActiveText = stripMaybe(extractFirst(segment, /<div class="left middle-list-reply[\s\S]*?>([^<]+)<\/div>/));
  const publishedText = stripMaybe(extractFirst(segment, /<div class="left middle-list-post[\s\S]*?>([^<]+)<\/div>/));

  return {
    id: normalizeTopicId(href),
    canonicalUrl: normalizeTopicUrl(href),
    title,
    authorName,
    source: "bbs",
    sourceLabel: "论坛主列表",
    sourceRank: index + 1,
    replyCount: Number.parseInt(replyCountText ?? "0", 10) || 0,
    publishedAt: parseMonthDayTime(publishedText, now),
    lastActiveAt: parseMonthDayTime(lastActiveText, now) ?? now.toISOString()
  };
}

function parseLinkedTitleBlocks(html: string, now: Date, source: PostCandidate["source"], sourceLabel: string): PostCandidate[] {
  const matches = Array.from(html.matchAll(/href="(a\/[^"]+)"[^>]*title=['"]([^'"]+)['"][\s\S]{0,240}?>([\s\S]*?)<\/a>/g));
  return matches.map((match, index) => ({
    id: normalizeTopicId(match[1]),
    canonicalUrl: normalizeTopicUrl(match[1]),
    title: stripHtml(match[2] || match[3]),
    authorName: extractNearbyAuthor(html, match.index ?? 0) ?? "未知作者",
    source,
    sourceLabel,
    sourceRank: index + 1,
    replyCount: 0,
    lastActiveAt: now.toISOString()
  }));
}

function extractNearbyAuthor(html: string, index: number): string | undefined {
  const segment = html.slice(index, index + 300);
  return stripMaybe(segment.match(/>([^<>]{2,20})<\/a>/)?.[1]);
}

function parseHeadContent(html: string): string {
  const articleContent = extractFirst(html, /<div class="article-text[^"]*"[^>]*>([\s\S]*?)<div class="clear"><\/div>/)
    ?? extractFirst(html, /<div class="article-text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<!-- 专区没有权限 -->/)
    ?? extractFirst(html, /<div class="pc_p_nr">([\s\S]*?)<\/div>/)
    ?? extractFirst(html, /<div class="content-main">([\s\S]*?)<\/div>/)
    ?? extractFirst(html, /<div class="article-content">([\s\S]*?)<div class="article-button[\s\S]*?<\/div>/)
    ?? extractFirst(html, /<div class="article-content">([\s\S]*?)<\/div>/);
  const cleaned = stripMaybe(articleContent) ?? "";
  return cleaned.replace(/^\d+[。.]\s*/, "").trim();
}

function parseReplies(html: string): string[] {
  const matches = Array.from(html.matchAll(/<div[^>]+class="[^"]*(?:reply-content|comment-data-text)[^"]*"[^>]*>([\s\S]*?)<\/div>/g));
  const replies = matches.map((match) => stripMaybe(match[1]) ?? "").filter((value) => value && value.length > 8);
  if (replies.length > 0) return dedupeStrings(replies).slice(0, 8);

  const fallbackMatches = Array.from(html.matchAll(/id="reply[^"]+"[^>]*>([\s\S]*?)<\/div>/g));
  return dedupeStrings(fallbackMatches.map((match) => stripMaybe(match[1]) ?? "").filter((value) => value && value.length > 8)).slice(0, 8);
}

function parseMonthDayTime(value: string | undefined, now: Date): string | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return undefined;
  const currentYear = Number(new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: "Asia/Shanghai" }).format(now));
  return `${currentYear}-${match[1]}-${match[2]}T${match[3]}:${match[4]}:00+08:00`;
}

async function fetchText(url: string, config: BriefConfig): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Cookie: config.tgbCookie,
      Referer: "https://www.tgb.cn/"
    },
    signal: AbortSignal.timeout(config.requestTimeoutMs)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Taoguba fetch HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return text;
}

function dedupeCandidates(candidates: PostCandidate[]): PostCandidate[] {
  const byKey = new Map<string, PostCandidate>();
  for (const candidate of candidates) {
    const key = candidate.id || candidate.canonicalUrl;
    const existing = byKey.get(key);
    if (!existing || scoreCandidate(candidate) > scoreCandidate(existing)) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()];
}

function scoreCandidate(candidate: PostCandidate): number {
  const sourceBoost = candidate.source === "home" ? 1000 : 0;
  const activity = Date.parse(candidate.lastActiveAt);
  const timeBoost = Number.isNaN(activity) ? 0 : Math.floor(activity / 1000);
  const rankPenalty = candidate.sourceRank * 10;
  return sourceBoost + timeBoost + candidate.replyCount * 20 - rankPenalty;
}

function normalizeTopicId(input: string): string {
  const match = input.match(/a\/([^/\-?]+)(?:-\d+)?/);
  return match?.[1] ?? input;
}

function extractTickers(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(/\b\d{6}\b/g)).map((match) => match[0]))].slice(0, 8);
}

function extractFirst(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1];
}

function stripMaybe(value: string | undefined): string | undefined {
  return value ? stripHtml(value) : undefined;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function simpleHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return `fp-${(hash >>> 0).toString(16)}`;
}
