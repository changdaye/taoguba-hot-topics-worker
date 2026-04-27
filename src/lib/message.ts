import type { DigestSourcePost, RuntimeState } from "../types";
import { truncate } from "./value";

const MAX_MESSAGE_LENGTH = 2600;
const ACTION_VALUES = ["继续观望", "轻仓试错", "只做最强", "不建议出手"] as const;
const DIRECTION_RULES = [
  { label: "国产算力 / AI硬件", keywords: ["算力", "CPO", "光模块", "光通信", "GPU", "服务器", "国产替代", "通信", "中际旭创", "新易盛", "杭电股份", "亨通光电", "中国长城", "富瀚微", "深圳华强"] },
  { label: "机器人", keywords: ["机器人", "人形", "减速器", "伺服", "智能制造"] },
  { label: "电力 / 绿能", keywords: ["电力", "绿能", "储能", "风电", "光伏", "电网"] },
  { label: "医药", keywords: ["医药", "创新药", "药业", "津药", "金陵药业"] },
  { label: "可转债 / 情绪套利", keywords: ["可转债", "转债", "情绪流", "弱转强", "反核", "首板", "连板"] }
];

export function buildDigestMessage(analysis: string, _items: DigestSourcePost[], detailedReportUrl?: string, modelLabel = ""): string {
  const lines = modelLabel ? [`🤖 模型：${modelLabel}`, "", normalizeAnalysisText(analysis)] : [normalizeAnalysisText(analysis)];
  if (detailedReportUrl) {
    lines.push("", "详细版报告:", detailedReportUrl);
  }
  return limitMessage(lines.join("\n"));
}

export function buildFallbackMessage(items: DigestSourcePost[], detailedReportUrl?: string, modelLabel = ""): string {
  const tickers = collectTickers(items);
  const direction = inferDirectionFromItems(items);
  const topTitles = items.slice(0, 3).map((item, index) => `${index + 1}. ${truncate(item.title, 36)}`);
  const lead = modelLabel ? [`🤖 模型：${modelLabel}`, "", "说明: AI 摘要暂不可用，以下为规则提炼摘要", ""] : ["说明: AI 摘要暂不可用，以下为规则提炼摘要", ""];
  const lines = [
    ...lead,
    "出手判断：仅作观察，等待模型判断恢复后再决定是否出手。",
    `方向判断：${direction}`,
    `观察标的：${tickers.length > 0 ? tickers.join("、") : "暂无明确高频标的"}`,
    "风险提醒：当前为规则提炼结果，不建议据此直接重仓或无脑追高。",
    `补充线索：${topTitles.join("；")}`
  ];
  if (detailedReportUrl) {
    lines.push("", "详细版报告:", detailedReportUrl);
  }
  return limitMessage(lines.join("\n"));
}

export function buildHeartbeatMessage(state: RuntimeState, intervalHours: number): string {
  return [
    "💓 淘股吧热帖简报 Worker 心跳",
    `心跳间隔: ${intervalHours}h`,
    `上次成功: ${state.lastSuccessAt ?? "无"}`,
    `连续失败: ${state.consecutiveFailures}`,
    state.lastError ? `最近错误: ${state.lastError}` : "最近错误: 无"
  ].join("\n");
}

export function buildFailureAlertMessage(state: RuntimeState, threshold: number): string {
  return [
    "🚨 淘股吧热帖简报 Worker 异常告警",
    `连续失败: ${state.consecutiveFailures}`,
    `告警阈值: ${threshold}`,
    `上次成功: ${state.lastSuccessAt ?? "无"}`,
    `最近错误: ${state.lastError ?? "unknown"}`
  ].join("\n");
}


export function normalizeAnalysisText(text: string): string {
  const cleaned = text
    .replace(/\*\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = cleaned
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^时间[:：]/.test(line))
    .filter((line) => !/^链接[:：]/.test(line));

  const action = normalizeAction(pickSection(lines, "出手判断"));
  const direction = pickSection(lines, "方向判断") ?? fallbackDirection(lines, cleaned);
  const watchlist = normalizeWatchlist(pickSection(lines, "观察标的") ?? pickSection(lines, "关注代码") ?? inferWatchlistFromText(cleaned));
  const risk = pickSection(lines, "风险提醒") ?? "当前输出未完整命中决策格式，不建议据此直接重仓。";

  return [
    `出手判断：${action}`,
    `方向判断：${direction}`,
    `观察标的：${watchlist}`,
    `风险提醒：${risk}`
  ].join("\n");
}

function collectTickers(items: DigestSourcePost[]): string[] {
  return [...new Set(items.flatMap((item) => item.mentionedTickers))].slice(0, 5);
}

function pickSection(lines: string[], label: string): string | undefined {
  const line = lines.find((entry) => entry.startsWith(`${label}：`) || entry.startsWith(`${label}:`));
  if (!line) return undefined;
  return line.replace(new RegExp(`^${label}[:：]\\s*`), "").trim();
}

function inferDirectionFromItems(items: DigestSourcePost[]): string {
  const sourceText = items.flatMap((item) => [item.title, item.headContent, ...item.sampledReplies]).join("\n");
  const picks = DIRECTION_RULES
    .filter((rule) => rule.keywords.some((keyword) => sourceText.includes(keyword)))
    .map((rule) => rule.label)
    .slice(0, 3);
  return picks.length > 0 ? picks.join("、") : "短线情绪修复与板块轮动";
}

function fallbackDirection(lines: string[], cleaned: string): string {
  const firstNarrative = lines.find((line) => !/^(出手判断|方向判断|观察标的|关注代码|风险提醒)[:：]/.test(line));
  if (firstNarrative) {
    return truncate(firstNarrative.replace(/^总览[:：]\s*/, ""), 80);
  }
  return inferDirectionFromText(cleaned);
}

function inferDirectionFromText(text: string): string {
  const picks = DIRECTION_RULES
    .filter((rule) => rule.keywords.some((keyword) => text.includes(keyword)))
    .map((rule) => rule.label)
    .slice(0, 3);
  return picks.length > 0 ? picks.join("、") : "短线情绪修复与板块轮动";
}

function inferWatchlistFromText(text: string): string {
  const explicit = text.match(/(?:观察标的|关注代码)[:：]\s*([^\n]+)/)?.[1]?.trim();
  if (explicit) return normalizeWatchlist(explicit);
  const candidates = Array.from(new Set(text.match(/\b\d{6}\b/g) ?? [])).slice(0, 8);
  return candidates.length > 0 ? candidates.slice(0, 5).join("、") : "暂无明确高频标的";
}

function normalizeAction(value: string | undefined): string {
  const cleaned = value?.trim() ?? "";
  if (!cleaned) return "继续观望";
  if ((ACTION_VALUES as readonly string[]).includes(cleaned)) return cleaned;
  const ordered = [...ACTION_VALUES]
    .map((label) => ({ label, index: cleaned.indexOf(label) }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index);
  if (ordered.length > 0) return ordered[0].label;
  if (/(不建议|不要|不可|别做|谨慎|空仓)/.test(cleaned)) return "不建议出手";
  if (/(最强|龙头|核心前排)/.test(cleaned)) return "只做最强";
  if (/(轻仓|试错|低吸|小仓)/.test(cleaned)) return "轻仓试错";
  return "继续观望";
}

function normalizeWatchlist(value: string): string {
  const items = value
    .split(/[、，,；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 0) return "暂无明确高频标的";
  return [...new Set(items)].slice(0, 5).join("、");
}

function limitMessage(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  return `${text.slice(0, MAX_MESSAGE_LENGTH - 15).trimEnd()}\n\n（内容已截断）`;
}
