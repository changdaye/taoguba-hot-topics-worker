import { describe, expect, it, vi } from "vitest";
import { runFinalSummary } from "../src/services/final-summary";
import type { BriefConfig } from "../src/types";
import * as cos from "../src/services/cos";
import * as feishu from "../src/services/feishu";

function makeConfig(): BriefConfig {
  return {
    feishuWebhook: "https://example.com/hook",
    feishuSecret: "secret",
    manualTriggerToken: "token",
    tgbCookie: "cookie",
    cosSecretId: "secret-id",
    cosSecretKey: "secret-key",
    cosBucket: "bucket",
    cosRegion: "ap-shanghai",
    cosBaseUrl: "https://bucket.cos.ap-shanghai.myqcloud.com",
    workerPublicBaseUrl: "https://example.workers.dev",
    llmBaseUrl: "",
    llmApiKey: "",
    llmModel: "@cf/meta/llama-3.2-1b-instruct",
    digestIntervalHours: 3,
    heartbeatIntervalHours: 24,
    requestTimeoutMs: 15000,
    fetchWindowHours: 3,
    maxPostsPerDigest: 12,
    maxRepliesPerPost: 8,
    failureAlertThreshold: 1,
    failureAlertCooldownMinutes: 180,
    tgbHomeUrl: "https://www.tgb.cn/",
    tgbBbsUrl: "https://www.tgb.cn/bbs/",
    finalSummaryHourLocal: 0,
    finalSummaryMinuteLocal: 30,
    finalSummaryLookbackHours: 24,
    marketTimezone: "Asia/Shanghai"
  };
}

describe("runFinalSummary", () => {
  it("reads archived messages, uploads final summary, and pushes only the link notice", async () => {
    vi.spyOn(cos, "listCosObjects").mockResolvedValue([
      { key: "taoguba-hot-topics-worker/feishu-messages/20260427080055.txt" },
      { key: "taoguba-hot-topics-worker/feishu-messages/20260427100055.txt" }
    ] as any);
    vi.spyOn(cos, "fetchCosObjectText")
      .mockResolvedValueOnce("【今日结论】\n第一条")
      .mockResolvedValueOnce("【今日结论】\n第二条");
    vi.spyOn(cos, "uploadFinalSummaryToCos").mockResolvedValue({
      key: "taoguba-hot-topics-worker/final-summaries/20260428003000.txt",
      url: "https://bucket.cos.ap-shanghai.myqcloud.com/taoguba-hot-topics-worker/final-summaries/20260428003000.txt"
    });
    const pushSpy = vi.spyOn(feishu, "pushToFeishu").mockResolvedValue();

    const result = await runFinalSummary({ AI: { run: vi.fn().mockResolvedValue({ response: "【凌晨总结】\n\n【核心脉络】\n两条消息偏谨慎。\n\n【主要风险】\n波动仍大。" }) } as any } as any, makeConfig(), new Date("2026-04-28T00:30:00.000Z"));

    expect(result?.includedCount).toBe(2);
    expect(result?.key).toContain("final-summaries/20260428003000.txt");
    expect(result?.content).toContain("【凌晨总结】");
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy.mock.calls[0]?.[1]).toContain("【凌晨总结已生成】");
    expect(pushSpy.mock.calls[0]?.[1]).toContain("详细版存档:");
  });
});
