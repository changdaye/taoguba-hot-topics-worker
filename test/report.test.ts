import { describe, expect, it } from "vitest";
import { buildDetailedReport, buildDetailedReportObjectKey } from "../src/lib/report";
import type { DigestSourcePost } from "../src/types";

const posts: DigestSourcePost[] = [{
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
  sampledReplies: ["核心还是看辨识度。", "分歧转一致才是关键。"],
  mentionedTickers: ["300024", "002031"],
  rawMetrics: {}
}];

describe("buildDetailedReport", () => {
  it("renders a markdown detailed report for Taoguba posts", () => {
    const report = buildDetailedReport("社区主线聚焦机器人回流。\n关注代码：300024、002031", posts, true, new Date("2026-04-25T01:02:03Z"));
    expect(report).toContain("# 淘股吧热帖简报详细版");
    expect(report).toContain("## 本轮总览");
    expect(report).toContain("### 1. 机器人概念分歧后回流");
    expect(report).toContain("- 原帖链接: https://www.tgb.cn/a/2rhqO0yVCwy-1");
  });
});

describe("buildDetailedReportObjectKey", () => {
  it("builds a stable markdown object key", () => {
    const key = buildDetailedReportObjectKey(new Date("2026-04-25T01:02:03Z"));
    expect(key).toBe("taoguba-hot-topics-worker/20260425010203.md");
  });
});
