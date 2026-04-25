import type { DigestSourcePost } from "../types";

const PROJECT_PREFIX = "taoguba-hot-topics-worker";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMultilineText(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

export function buildDetailedReport(analysis: string, posts: DigestSourcePost[], aiAnalysis: boolean, now = new Date()): string {
  const postCards = posts.map((post, index) => `
      <article class="item-card">
        <h3>${index + 1}. ${escapeHtml(post.title)}</h3>
        <dl>
          <div><dt>作者</dt><dd>${escapeHtml(post.authorName)}</dd></div>
          <div><dt>来源</dt><dd>${escapeHtml(post.sourceLabel)}</dd></div>
          <div><dt>回帖数</dt><dd>${post.replyCount}</dd></div>
          <div><dt>原帖链接</dt><dd><a href="${escapeHtml(post.canonicalUrl)}">${escapeHtml(post.canonicalUrl)}</a></dd></div>
          <div><dt>最近活跃</dt><dd>${escapeHtml(post.lastActiveAt)}</dd></div>
          <div><dt>首帖核心观点</dt><dd>${formatMultilineText(post.headContent || "（未解析到首帖正文）")}</dd></div>
          <div><dt>高频代码</dt><dd>${escapeHtml(post.mentionedTickers.length > 0 ? post.mentionedTickers.join("、") : "无")}</dd></div>
        </dl>
        ${post.sampledReplies.length > 0 ? `<div class="reply-block"><strong>代表性回帖观点</strong><ol>${post.sampledReplies.map((reply) => `<li>${formatMultilineText(reply)}</li>`).join("")}</ol></div>` : ""}
      </article>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>淘股吧热帖简报详细版</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; margin: 0; background: #f5f7fb; color: #111827; }
    .wrap { max-width: 980px; margin: 0 auto; padding: 32px 20px 48px; }
    .card { background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08); margin-bottom: 20px; }
    h1, h2, h3 { margin-top: 0; }
    .meta { color: #64748b; line-height: 1.9; }
    .summary { line-height: 1.85; font-size: 16px; }
    .item-card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; margin-top: 16px; }
    dl { margin: 0; display: grid; gap: 10px; }
    dt { font-weight: 700; }
    dd { margin: 4px 0 0; color: #334155; line-height: 1.8; }
    .reply-block { margin-top: 14px; }
    ol { margin: 8px 0 0; padding-left: 20px; line-height: 1.8; }
    a { color: #2563eb; word-break: break-all; }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="card">
      <h1>淘股吧热帖简报详细版</h1>
      <div class="meta">
        <div><strong>生成时间：</strong>${escapeHtml(now.toISOString())}</div>
        <div><strong>热帖数量：</strong>${posts.length}</div>
        <div><strong>AI 摘要：</strong>${aiAnalysis ? "是" : "否（使用回退摘要）"}</div>
      </div>
    </section>

    <section class="card">
      <h2>本轮总览</h2>
      <div class="summary">${formatMultilineText(analysis)}</div>
    </section>

    <section class="card">
      <h2>重点热帖逐条拆解</h2>
      ${postCards || "<p>本轮没有可展示的热帖。</p>"}
    </section>
  </div>
</body>
</html>
`;
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

  return `${PROJECT_PREFIX}/${stamp}.html`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
