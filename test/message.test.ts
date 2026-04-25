import { describe, expect, it } from "vitest";
import { buildDigestMessage, buildFallbackMessage, normalizeAnalysisText } from "../src/lib/message";
import type { DigestSourcePost } from "../src/types";

function makePost(overrides: Partial<DigestSourcePost> = {}): DigestSourcePost {
  return {
    id: "post-1",
    canonicalUrl: "https://www.tgb.cn/a/2rhqO0yVCwy-1",
    title: "机器人概念分歧后回流，资金继续抱团高辨识度个股",
    authorName: "短线选手",
    source: "bbs",
    sourceLabel: "论坛主列表",
    sourceRank: 1,
    replyCount: 128,
    publishedAt: "2026-04-25T09:30:00+08:00",
    lastActiveAt: "2026-04-25T10:30:00+08:00",
    headContent: "今天主要看机器人和算力回流。",
    sampledReplies: ["核心还是看辨识度。"],
    mentionedTickers: ["机器人(300024)", "算力核心(002031)"],
    rawMetrics: {},
    ...overrides
  };
}

describe("buildDigestMessage", () => {
  it("includes the model label and detailed report footer", () => {
    const result = buildDigestMessage(
      "出手判断：轻仓试错，只做最强。\n方向判断：机器人修复、算力回流。\n观察标的：机器人(300024)、算力核心(002031)\n风险提醒：高潮后别追高。",
      [makePost()],
      "https://cos.example/report.md",
      "GPT 5.4 (xhigh)"
    );

    expect(result).toContain("🤖 模型：GPT 5.4 (xhigh)");
    expect(result).toContain("出手判断：轻仓试错");
    expect(result).toContain("观察标的：机器人(300024)、算力核心(002031)");
    expect(result).toContain("详细版报告:");
    expect(result).not.toContain("链接:");
  });
});

describe("normalizeAnalysisText", () => {
  it("normalizes analysis into a pre-market decision card", () => {
    const result = normalizeAnalysisText("出手判断：轻仓试错\n方向判断：机器人修复、算力回流\n关注代码：机器人(300024)、算力核心(002031)\n风险提醒：高潮后别追高。");
    expect(result).toContain("出手判断：");
    expect(result).toContain("方向判断：");
    expect(result).toContain("观察标的：机器人(300024)、算力核心(002031)");
    expect(result).toContain("风险提醒：");
  });
});

describe("buildFallbackMessage", () => {
  it("renders a conservative decision card when AI output is unavailable", () => {
    const result = buildFallbackMessage([makePost()], "https://cos.example/report.md", "Llama 3.2 1B Instruct");
    expect(result).toContain("说明: AI 摘要暂不可用");
    expect(result).toContain("出手判断：");
    expect(result).toContain("方向判断：");
    expect(result).toContain("观察标的：机器人(300024)、算力核心(002031)");
    expect(result).toContain("风险提醒：");
    expect(result).toContain("详细版报告:");
  });
});
