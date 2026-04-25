import type { DigestSourcePost, RuntimeState } from "../types";
import { truncate } from "./value";

const MAX_MESSAGE_LENGTH = 2600;

export function buildDigestMessage(analysis: string, _items: DigestSourcePost[], detailedReportUrl?: string, modelLabel = ""): string {
  const lines = modelLabel ? [`🤖 模型：${modelLabel}`, "", normalizeAnalysisText(analysis)] : [normalizeAnalysisText(analysis)];
  if (detailedReportUrl) {
    lines.push("", "详细版报告:", detailedReportUrl);
  }
  return limitMessage(lines.join("\n"));
}

export function buildFallbackMessage(items: DigestSourcePost[], detailedReportUrl?: string, modelLabel = ""): string {
  const tickers = collectTickers(items);
  const lead = modelLabel ? [`🤖 模型：${modelLabel}`, "", "说明: AI 摘要暂不可用，以下为规则提炼摘要", ""] : ["说明: AI 摘要暂不可用，以下为规则提炼摘要", ""];
  const topTitles = items.slice(0, 3).map((item, index) => `${index + 1}. ${truncate(item.title, 36)}`);
  const lines = [
    ...lead,
    `社区当前高频讨论集中在：${topTitles.join("；")}`,
    `关注代码：${tickers.length > 0 ? tickers.join("、") : "暂无明确高频代码"}`
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

export function buildWakeSummaryMessage(message: string, quietDigestCount: number): string {
  return [
    "🌅 隔夜汇总",
    `北京时间 22:00 - 08:00 静默时段内累计更新 ${quietDigestCount} 次，以下为最新一版摘要：`,
    "",
    message,
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

  if (lines.some((line) => /^关注代码[:：]/.test(line))) {
    return lines.join("\n");
  }

  return [...lines, "关注代码：暂无明确高频代码"].join("\n");
}

function collectTickers(items: DigestSourcePost[]): string[] {
  return [...new Set(items.flatMap((item) => item.mentionedTickers))].slice(0, 6);
}

function limitMessage(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  return `${text.slice(0, MAX_MESSAGE_LENGTH - 15).trimEnd()}\n\n（内容已截断）`;
}
