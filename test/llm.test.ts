import { describe, expect, it, vi } from "vitest";
import { analyzeWithLLM } from "../src/services/llm";
import type { BriefConfig, DigestSourcePost } from "../src/types";

function makeConfig(): BriefConfig {
  return {
    feishuWebhook: "https://example.com/hook",
    feishuSecret: "",
    manualTriggerToken: "token",
    tgbCookie: "cookie",
    llmModel: "@cf/meta/llama-3.1-8b-instruct",
    digestIntervalHours: 3,
    heartbeatIntervalHours: 24,
    requestTimeoutMs: 15000,
    fetchWindowHours: 3,
    maxPostsPerDigest: 12,
    maxRepliesPerPost: 8,
    failureAlertThreshold: 1,
    failureAlertCooldownMinutes: 180,
    cosSecretId: "secret-id",
    cosSecretKey: "secret-key",
    cosBucket: "bucket",
    cosRegion: "na-ashburn",
    cosBaseUrl: "https://bucket.cos.na-ashburn.myqcloud.com",
    llmBaseUrl: "",
    llmApiKey: "",
    tgbHomeUrl: "https://www.tgb.cn/",
    tgbBbsUrl: "https://www.tgb.cn/bbs/"
  };
}

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
    mentionedTickers: ["300024", "002031"],
    rawMetrics: {},
    ...overrides
  };
}

describe("analyzeWithLLM", () => {
  it("prefers the OpenAI-compatible proxy when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "社区主线聚焦机器人回流。\n关注代码：300024、002031" } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await analyzeWithLLM({ ...makeConfig(), llmBaseUrl: "https://proxy.example.com/v1", llmApiKey: "proxy-key", llmModel: "gpt-5.4" }, { run: vi.fn() } as unknown as Ai, [makePost()]);
    expect(result).toEqual({ analysis: "社区主线聚焦机器人回流。\n关注代码：300024、002031", modelLabel: "GPT 5.4 (xhigh)" });
  });

  it("falls back to Workers AI when the proxy fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 })));
    const run = vi.fn().mockResolvedValue({ response: "社区主线聚焦机器人回流。\n关注代码：300024、002031" });
    const result = await analyzeWithLLM({ ...makeConfig(), llmBaseUrl: "https://proxy.example.com/v1", llmApiKey: "proxy-key", llmModel: "gpt-5.4" }, { run } as unknown as Ai, [makePost()]);
    expect(result.modelLabel).toBe("Llama 3.2 1B Instruct");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
