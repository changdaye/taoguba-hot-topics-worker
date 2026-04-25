import type { BriefConfig, DigestSourcePost, PostCandidate, PostPushStateRecord, TaogubaSnapshot } from "../types";
import { stripHtml, truncate } from "../lib/value";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const REPUSH_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const MARKET_TITLE_KEYWORDS = ["复盘", "涨停", "跌停", "竞价", "龙头", "板块", "情绪", "题材", "指数", "量化", "AI", "算力", "CPO", "光模块", "通信", "锂电", "医药", "航天", "重组", "芯片", "可转债", "大盘", "盘面", "连板", "预期", "节点", "仓位", "低吸", "反核", "修复", "抱团", "首板", "二板", "主线", "市场", "热点"];
const GENERIC_TITLE_KEYWORDS = ["交流贴", "提问太多", "唯一交流贴", "成熟交易者", "年赛结束", "足迹", "天之道", "新开一帖", "每日实盘", "路好难", "成长", "炼成", "问答", "心路", "闲聊"];
const IGNORED_MENTION_TOKENS = new Set(["淘股吧", "A股", "市场", "超短", "主线", "龙头", "情绪", "指数", "题材", "复盘", "盘面"]);
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

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
  const mentionedTickers = dedupeStrings([
    ...extractTickers([title, headContent, ...sampledReplies].join("\n")),
    ...extractTickersFromHtml(html)
  ]).slice(0, 8);

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
  const now = Date.now();
  const activeAt = Date.parse(candidate.lastActiveAt);
  const publishedAt = candidate.publishedAt ? Date.parse(candidate.publishedAt) : Number.NaN;
  const activeHours = Number.isNaN(activeAt) ? 999 : Math.max(0, (now - activeAt) / MS_PER_HOUR);
  const publishedDays = Number.isNaN(publishedAt) ? 999 : Math.max(0, (now - publishedAt) / MS_PER_DAY);
  const sourceBoost = candidate.source === "home" ? 40 : 0;
  const rankBoost = Math.max(0, 140 - candidate.sourceRank * 8);
  const recencyBoost = activeHours <= 2 ? 40 : activeHours <= 12 ? 25 : activeHours <= 24 ? 15 : activeHours <= 72 ? 8 : 0;
  const freshnessBoost = publishedDays <= 7 ? 20 : publishedDays <= 30 ? 10 : 0;
  const replyBoost = Math.min(18, Math.log10(candidate.replyCount + 1) * 6);
  return sourceBoost + rankBoost + recencyBoost + freshnessBoost + replyBoost + scoreTitleRelevance(candidate.title);
}

function normalizeTopicId(input: string): string {
  const match = input.match(/a\/([^/\-?]+)(?:-\d+)?/);
  return match?.[1] ?? input;
}

function extractTickers(text: string): string[] {
  return dedupeStrings(Array.from(text.matchAll(/\b\d{6}\b/g)).map((match) => match[0])).slice(0, 8);
}

function extractTickersFromHtml(html: string): string[] {
  const mentions: string[] = [];

  for (const match of html.matchAll(/name=['"]T([^'"]{2,20})['"]/g)) {
    const token = normalizeMentionToken(match[1]);
    if (token) mentions.push(token);
  }

  for (const match of html.matchAll(/stockName=([^&'"\s>]+)/g)) {
    const token = normalizeMentionToken(decodeUrlComponent(match[1]));
    if (token) mentions.push(token);
  }

  for (const match of html.matchAll(/\/quotes\/(?:sh|sz)(\d{6})/g)) {
    const token = normalizeMentionToken(match[1]);
    if (token) mentions.push(token);
  }

  return dedupeStrings(mentions).slice(0, 8);
}

function scoreTitleRelevance(title: string): number {
  const positive = countKeywordHits(title, MARKET_TITLE_KEYWORDS) * 14;
  const negative = countKeywordHits(title, GENERIC_TITLE_KEYWORDS) * 18;
  return positive - negative;
}

function countKeywordHits(text: string, keywords: string[]): number {
  return keywords.reduce((total, keyword) => total + (text.includes(keyword) ? 1 : 0), 0);
}

function normalizeMentionToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = stripHtml(value).replace(/^T/, "").replace(/\s+/g, "").trim();
  if (!cleaned) return undefined;
  if (IGNORED_MENTION_TOKENS.has(cleaned)) return undefined;
  if (/^\d{6}$/.test(cleaned)) return cleaned;
  if (/^[一-龥A-Za-z]{2,12}$/.test(cleaned)) return cleaned;
  return undefined;
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
