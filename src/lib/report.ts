import type { DigestSourcePost } from "../types";

const PROJECT_PREFIX = "taoguba-hot-topics-worker";

export function buildDetailedReport(analysis: string, posts: DigestSourcePost[], aiAnalysis: boolean, now = new Date()): string {
  const lines: string[] = [
    "# 淘股吧热帖简报详细版",
    "",
    `- 生成时间: ${now.toISOString()}`,
    `- 热帖数量: ${posts.length}`,
    `- AI 摘要: ${aiAnalysis ? "是" : "否（使用回退摘要）"}`,
    "",
    "## 本轮总览",
    "",
    analysis,
    "",
    "## 重点热帖逐条拆解",
    ""
  ];

  posts.forEach((post, index) => {
    lines.push(`### ${index + 1}. ${post.title}`);
    lines.push(`- 作者: ${post.authorName}`);
    lines.push(`- 来源: ${post.sourceLabel}`);
    lines.push(`- 回帖数: ${post.replyCount}`);
    lines.push(`- 原帖链接: ${post.canonicalUrl}`);
    lines.push(`- 最近活跃: ${post.lastActiveAt}`);
    lines.push("- 首帖核心观点:");
    lines.push(post.headContent || "（未解析到首帖正文）");
    if (post.sampledReplies.length > 0) {
      lines.push("- 代表性回帖观点:");
      post.sampledReplies.forEach((reply, replyIndex) => {
        lines.push(`  ${replyIndex + 1}. ${reply}`);
      });
    }
    lines.push(`- 高频代码: ${post.mentionedTickers.length > 0 ? post.mentionedTickers.join("、") : "无"}`);
    lines.push("");
  });

  return `${lines.join("\n").trim()}\n`;
}

export function buildDetailedReportObjectKey(now = new Date()): string {
  const stamp = [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds())
  ].join("");

  return `${PROJECT_PREFIX}/${stamp}.md`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
