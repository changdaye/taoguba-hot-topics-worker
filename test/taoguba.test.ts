import { describe, expect, it } from "vitest";
import {
  buildPostFingerprint,
  parseBbsListPage,
  parseDetailPage,
  pickPostsForDigest,
  shouldRepushPost
} from "../src/services/taoguba";

const bbsFixture = `
<div class="Nbbs-tiezi-lists">
  <div class="left middle-list-tittle fs15 c333 cursor overhide">
    <a class="overhide mw300" href="a/2rhqO0yVCwy" title='明晚直播：认清板块联动是真龙确立关键！' target="_blank">明晚直播：认清板块联动是真龙确立关键！</a>
    <span>&nbsp;(11895)</span>
  </div>
  <div class="left middle-list-talk overhide cursor">329 / 3186</div>
  <div class="left middle-list-reply cursor">04-25 16:51</div>
  <div class="left middle-list-user cblue cursor overhide">
    <a class="mw100 overhide" href="blog/13186975" target="_blank">主升龙头空空龙</a>
  </div>
  <div class="left middle-list-post cursor">04-25 13:11</div>
</div>
<div class="Nbbs-tiezi-lists">
  <div class="left middle-list-tittle fs15 c333 cursor overhide">
    <a class="overhide mw300" href="a/2rhqO0yVCwy" title='明晚直播：认清板块联动是真龙确立关键！' target="_blank">明晚直播：认清板块联动是真龙确立关键！</a>
  </div>
  <div class="left middle-list-talk overhide cursor">329 / 3186</div>
  <div class="left middle-list-reply cursor">04-25 16:51</div>
  <div class="left middle-list-user cblue cursor overhide">
    <a class="mw100 overhide" href="blog/13186975" target="_blank">主升龙头空空龙</a>
  </div>
  <div class="left middle-list-post cursor">04-25 13:11</div>
</div>`;

const detailFixture = `
<title>明晚直播：认清板块联动是真龙确立关键！_主升龙头空空龙_淘股吧</title>
<div class="article-content">
  <p>今天复盘的关键是板块联动与辨识度切换。</p>
  <p>机器人、化工都要看分歧后的回流质量。</p>
</div>
<div id="reply123" class="reply-wrap">
  <div class="reply-content">最强的还是高辨识度前排。</div>
</div>
<div id="reply124" class="reply-wrap">
  <div class="reply-content">如果竞价不能加强，午后容易分歧。</div>
</div>`;

describe("parseBbsListPage", () => {
  it("extracts list candidates with title, author, counts, and canonical url", () => {
    const items = parseBbsListPage(bbsFixture, new Date("2026-04-25T08:52:00.000Z"));
    expect(items[0]).toMatchObject({
      id: "2rhqO0yVCwy",
      canonicalUrl: "https://www.tgb.cn/a/2rhqO0yVCwy-1",
      authorName: "主升龙头空空龙",
      replyCount: 329,
      source: "bbs"
    });
  });
});

describe("parseDetailPage", () => {
  it("extracts head content and sampled replies", () => {
    const detail = parseDetailPage("https://www.tgb.cn/a/2rhqO0yVCwy-1", detailFixture, new Date("2026-04-25T08:52:00.000Z"));
    expect(detail.headContent).toContain("板块联动");
    expect(detail.sampledReplies).toHaveLength(2);
  });
});

describe("fingerprint and repush rules", () => {
  it("changes the fingerprint when reply content changes", () => {
    const base = buildPostFingerprint({ title: "A", headContent: "B", sampledReplies: ["C"], lastActiveAt: "2026-04-25T10:00:00+08:00" });
    const changed = buildPostFingerprint({ title: "A", headContent: "B", sampledReplies: ["D"], lastActiveAt: "2026-04-25T10:00:00+08:00" });
    expect(changed).not.toBe(base);
  });

  it("repushes when the fingerprint changes", () => {
    expect(shouldRepushPost({ contentFingerprint: "old", lastPushedAt: "2026-04-25T06:00:00.000Z" }, { contentFingerprint: "new" }, new Date("2026-04-25T09:00:00.000Z"))).toBe(true);
  });
});

describe("pickPostsForDigest", () => {
  it("deduplicates and keeps the top 12 candidates", () => {
    const posts = Array.from({ length: 14 }, (_, index) => ({
      id: index < 2 ? "2rhqO0yVCwy" : `id-${index}`,
      canonicalUrl: index < 2 ? "https://www.tgb.cn/a/2rhqO0yVCwy-1" : `https://www.tgb.cn/a/id-${index}-1`,
      title: `post-${index}`,
      authorName: `author-${index}`,
      source: index < 7 ? "home" as const : "bbs" as const,
      sourceRank: index + 1,
      sourceLabel: index < 7 ? "首页推荐" : "论坛主列表",
      replyCount: 30 - index,
      lastActiveAt: `2026-04-25T1${index % 10}:00:00+08:00`
    }));
    expect(pickPostsForDigest(posts, 12)).toHaveLength(12);
  });
});
