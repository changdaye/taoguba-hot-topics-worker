# Taoguba Hot Topics Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Worker that scrapes Taoguba hot-topic pages every 3 hours, summarizes selected posts with Workers AI, uploads a detailed report, and pushes a short Feishu brief while avoiding duplicate pushes.

**Architecture:** Reuse the proven `jinshi-market-brief-worker` structure: one Worker entrypoint coordinates parsing, deduplication, AI summarization, D1 persistence, KV runtime state, COS upload, and Feishu delivery. Taoguba-specific logic lives in a dedicated scraper/parser service plus post-level fingerprint tracking.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, KV, Workers AI, Vitest, Wrangler

---

## File structure

- Create: `README.md`
- Create: `LICENSE`
- Create: `.editorconfig`
- Create: `.gitignore`
- Create: `.github/workflows/ci.yml`
- Create: `.dev.vars.example`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `wrangler.jsonc`
- Create: `scripts/check-cloudflare-account.mjs`
- Create: `migrations/0001_init.sql`
- Create: `src/index.ts`
- Create: `src/config.ts`
- Create: `src/db.ts`
- Create: `src/types.ts`
- Create: `src/lib/admin.ts`
- Create: `src/lib/message.ts`
- Create: `src/lib/report.ts`
- Create: `src/lib/runtime.ts`
- Create: `src/lib/schedule.ts`
- Create: `src/lib/value.ts`
- Create: `src/services/cos.ts`
- Create: `src/services/feishu.ts`
- Create: `src/services/llm.ts`
- Create: `src/services/taoguba.ts`
- Create: `test/admin.test.ts`
- Create: `test/message.test.ts`
- Create: `test/report.test.ts`
- Create: `test/schedule.test.ts`
- Create: `test/llm.test.ts`
- Create: `test/taoguba.test.ts`

### Task 1: Scaffold the Worker project from the approved shape

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `wrangler.jsonc`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `.github/workflows/ci.yml`
- Create: `scripts/check-cloudflare-account.mjs`
- Create: `README.md`
- Create: `LICENSE`
- Create: `.dev.vars.example`

- [ ] **Step 1: Create the package manifest and toolchain files**

```json
{
  "name": "taoguba-hot-topics-worker",
  "version": "0.1.0",
  "private": true,
  "description": "Cloudflare Worker that monitors Taoguba hot topics, summarizes community discussion, and pushes briefs to Feishu.",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "npm run check:cloudflare-account && wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm run test",
    "check:cloudflare-account": "node scripts/check-cloudflare-account.mjs"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "0.14.9",
    "@cloudflare/workers-types": "4.20260422.1",
    "typescript": "6.0.3",
    "vitest": "4.1.5",
    "wrangler": "4.84.1"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types", "vitest/globals"],
    "lib": ["ES2023"],
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" }
      }
    }
  }
});
```

- [ ] **Step 2: Add the first infrastructure docs/configs**

```gitignore
node_modules
.dev.vars
.wrangler
coverage
```

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

```yaml
name: ci

on:
  push:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run check
```

- [ ] **Step 3: Add Wrangler, README, and example env placeholders**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "taoguba-hot-topics-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-25",
  "account_id": "d66336592b3f62650da1e5fa60e4a28c",
  "workers_dev": true,
  "preview_urls": false,
  "observability": { "enabled": true },
  "triggers": { "crons": ["0 */3 * * *"] },
  "kv_namespaces": [{ "binding": "RUNTIME_KV", "id": "TODO", "preview_id": "TODO" }],
  "ai": { "binding": "AI" },
  "d1_databases": [{
    "binding": "BRIEF_DB",
    "database_name": "taoguba-hot-topics",
    "database_id": "TODO",
    "migrations_dir": "migrations"
  }],
  "vars": {
    "DIGEST_INTERVAL_HOURS": "3",
    "HEARTBEAT_INTERVAL_HOURS": "24",
    "REQUEST_TIMEOUT_MS": "15000",
    "FETCH_WINDOW_HOURS": "3",
    "MAX_POSTS_PER_DIGEST": "12",
    "MAX_REPLIES_PER_POST": "8",
    "LLM_MODEL": "gpt-5.4",
    "TGB_HOME_URL": "https://www.tgb.cn/",
    "TGB_BBS_URL": "https://www.tgb.cn/bbs/",
    "FAILURE_ALERT_THRESHOLD": "1",
    "FAILURE_ALERT_COOLDOWN_MINUTES": "180"
  }
}
```

```env
FEISHU_WEBHOOK=
FEISHU_SECRET=
MANUAL_TRIGGER_TOKEN=
TGB_COOKIE=
TENCENT_COS_SECRET_ID=
TENCENT_COS_SECRET_KEY=
TENCENT_COS_BUCKET=
TENCENT_COS_REGION=
TENCENT_COS_BASE_URL=
```

- [ ] **Step 4: Install dependencies and verify the empty scaffold tooling resolves**

Run: `npm install`
Expected: lockfile created, install exits 0

Run: `npm run typecheck`
Expected: fail because source files do not exist yet

### Task 2: Lock parser and formatting behavior with failing tests first

**Files:**
- Create: `test/admin.test.ts`
- Create: `test/message.test.ts`
- Create: `test/report.test.ts`
- Create: `test/schedule.test.ts`
- Create: `test/llm.test.ts`
- Create: `test/taoguba.test.ts`

- [ ] **Step 1: Add the shared behavior tests copied/adapted from the Jinshi worker**

```ts
import { describe, expect, it } from "vitest";
import { authorizeAdminRequest, readBearerToken } from "../src/lib/admin";

describe("readBearerToken", () => {
  it("extracts bearer tokens from the authorization header", () => {
    const request = new Request("https://example.com/admin/trigger", {
      method: "POST",
      headers: { Authorization: "Bearer secret-token" }
    });

    expect(readBearerToken(request)).toBe("secret-token");
  });
});

describe("authorizeAdminRequest", () => {
  it("rejects when the token is missing", () => {
    const request = new Request("https://example.com/admin/trigger", { method: "POST" });
    expect(authorizeAdminRequest(request, "secret-token")).toEqual({ ok: false, status: 401, error: "missing bearer token" });
  });
});
```

```ts
import { describe, expect, it } from "vitest";
import { buildDigestMessage, buildFallbackMessage } from "../src/lib/message";
import type { DigestSourcePost } from "../src/types";

const post: DigestSourcePost = {
  id: "post-1",
  canonicalUrl: "https://www.tgb.cn/a/2abc-1",
  title: "机器人概念分歧后回流，资金继续抱团高辨识度个股",
  authorName: "短线选手",
  source: "bbs",
  publishedAt: "2026-04-25T09:30:00+08:00",
  lastActiveAt: "2026-04-25T10:30:00+08:00",
  headContent: "今天主要看机器人和算力回流。",
  sampledReplies: ["核心还是看辨识度。"],
  replyCount: 128,
  sourceRank: 1,
  sourceLabel: "论坛主列表",
  mentionedTickers: ["300024", "002031"],
  rawMetrics: {}
};

describe("buildDigestMessage", () => {
  it("keeps the short-message style with the detailed report footer", () => {
    const result = buildDigestMessage("社区主线聚焦机器人回流。\n关注代码：300024、002031", [post], "https://cos.example/report.md", "GPT 5.4 (xhigh)");
    expect(result).toContain("关注代码：300024、002031");
    expect(result).toContain("详细版报告:");
    expect(result).not.toContain("链接:");
  });
});

describe("buildFallbackMessage", () => {
  it("renders a readable fallback when AI output is unavailable", () => {
    const result = buildFallbackMessage([post], "https://cos.example/report.md");
    expect(result).toContain("说明: AI 摘要暂不可用");
    expect(result).toContain("关注代码");
  });
});
```

- [ ] **Step 2: Add Taoguba-specific parser tests with fixed HTML fixtures**

```ts
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
      id: `id-${index}`,
      canonicalUrl: `https://www.tgb.cn/a/id-${index}-1`,
      title: `post-${index}`,
      authorName: `author-${index}`,
      source: index < 7 ? "home" : "bbs",
      sourceRank: index + 1,
      sourceLabel: index < 7 ? "首页推荐" : "论坛主列表",
      replyCount: 30 - index,
      lastActiveAt: `2026-04-25T1${index % 10}:00:00+08:00`
    }));
    expect(pickPostsForDigest(posts, 12)).toHaveLength(12);
  });
});
```

- [ ] **Step 3: Run the targeted test file and confirm RED**

Run: `npm test -- test/taoguba.test.ts`
Expected: FAIL because `src/services/taoguba.ts` does not exist yet

### Task 3: Implement the shared Worker foundations and make the shared tests pass

**Files:**
- Create: `src/types.ts`
- Create: `src/config.ts`
- Create: `src/lib/admin.ts`
- Create: `src/lib/message.ts`
- Create: `src/lib/report.ts`
- Create: `src/lib/runtime.ts`
- Create: `src/lib/schedule.ts`
- Create: `src/lib/value.ts`
- Create: `src/services/feishu.ts`
- Create: `src/services/cos.ts`
- Create: `src/services/llm.ts`

- [ ] **Step 1: Add the core types and config parser**

```ts
export interface Env {
  AI: Ai;
  RUNTIME_KV: KVNamespace;
  BRIEF_DB: D1Database;
  FEISHU_WEBHOOK: string;
  FEISHU_SECRET?: string;
  MANUAL_TRIGGER_TOKEN?: string;
  TGB_COOKIE?: string;
  TENCENT_COS_SECRET_ID: string;
  TENCENT_COS_SECRET_KEY: string;
  TENCENT_COS_BUCKET: string;
  TENCENT_COS_REGION: string;
  TENCENT_COS_BASE_URL?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  DIGEST_INTERVAL_HOURS?: string;
  HEARTBEAT_INTERVAL_HOURS?: string;
  REQUEST_TIMEOUT_MS?: string;
  FETCH_WINDOW_HOURS?: string;
  MAX_POSTS_PER_DIGEST?: string;
  MAX_REPLIES_PER_POST?: string;
  FAILURE_ALERT_THRESHOLD?: string;
  FAILURE_ALERT_COOLDOWN_MINUTES?: string;
  TGB_HOME_URL?: string;
  TGB_BBS_URL?: string;
}
```

- [ ] **Step 2: Port the shared admin/runtime/COS/Feishu helpers from the Jinshi worker with Taoguba-specific naming**

```bash
cp /Users/changdaye/Documents/jinshi-market-brief-worker/src/lib/admin.ts src/lib/admin.ts
cp /Users/changdaye/Documents/jinshi-market-brief-worker/src/lib/runtime.ts src/lib/runtime.ts
cp /Users/changdaye/Documents/jinshi-market-brief-worker/src/lib/schedule.ts src/lib/schedule.ts
cp /Users/changdaye/Documents/jinshi-market-brief-worker/src/lib/value.ts src/lib/value.ts
cp /Users/changdaye/Documents/jinshi-market-brief-worker/src/services/feishu.ts src/services/feishu.ts
cp /Users/changdaye/Documents/jinshi-market-brief-worker/src/services/cos.ts src/services/cos.ts
```

- [ ] **Step 3: Implement Taoguba-specific message, report, and LLM prompt helpers**

```ts
const SYSTEM_PROMPT = `你现在是一名中文A股社区观察员。
你的任务是把淘股吧热帖讨论整理成一条飞书社区热度简报。

输出要求：
- 先用2到4句总结当前主线、情绪、主要分歧。
- 明确写出“关注代码：”并列出 2 到 6 个代码。
- 不要输出时间、原帖链接、素材字段名。
- 不要把内容写成帖子清单。
- 风格像盘中/复盘简报，而不是聊天。`;
```

- [ ] **Step 4: Run the shared tests until GREEN**

Run: `npm test -- test/admin.test.ts test/message.test.ts test/report.test.ts test/schedule.test.ts test/llm.test.ts`
Expected: PASS

### Task 4: Implement Taoguba scraping, parsing, deduplication, and fingerprinting

**Files:**
- Create: `src/services/taoguba.ts`
- Modify: `src/types.ts`
- Modify: `test/taoguba.test.ts`

- [ ] **Step 1: Implement candidate/list parsing with URL normalization**

```ts
export function normalizeTopicUrl(input: string): string {
  const trimmed = input.replace(/^https?:\/\/www\.tgb\.cn\//, "").replace(/^\//, "");
  const path = trimmed.replace(/-\d+$/, "");
  return `https://www.tgb.cn/${path}-1`;
}
```

- [ ] **Step 2: Implement BBS parsing and best-effort home parsing**

```ts
export function parseBbsListPage(html: string, now = new Date()): PostCandidate[] {
  const starts = Array.from(html.matchAll(/<div class="Nbbs-tiezi-lists">([\s\S]*?)<div class="clear"><\/div>\s*<\/div>/g));
  return starts.map((match, index) => parseBbsCandidate(match[1], index, now)).filter(Boolean) as PostCandidate[];
}

export function parseHomeListPage(html: string, now = new Date()): PostCandidate[] {
  const links = Array.from(html.matchAll(/href="(a\/[^"]+)"[^>]*title=['"]([^'"]+)['"]/g));
  return links.map((match, index) => ({
    id: match[1].split("/").pop() ?? `home-${index}`,
    canonicalUrl: normalizeTopicUrl(match[1]),
    title: stripHtml(match[2]),
    authorName: extractNearbyAuthor(html, match.index ?? 0) ?? "未知作者",
    source: "home",
    sourceLabel: "首页推荐",
    sourceRank: index + 1,
    replyCount: 0,
    lastActiveAt: now.toISOString()
  }));
}
```

- [ ] **Step 3: Implement detail parsing, reply sampling, ticker extraction, and fingerprinting**

```ts
export function buildPostFingerprint(input: { title: string; headContent: string; sampledReplies: string[]; lastActiveAt: string }): string {
  const canonical = [input.title, input.headContent, ...input.sampledReplies, input.lastActiveAt]
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
  return simpleHash(canonical);
}
```

- [ ] **Step 4: Run the parser test and confirm GREEN**

Run: `npm test -- test/taoguba.test.ts`
Expected: PASS

### Task 5: Integrate D1 persistence and the Worker entrypoint

**Files:**
- Create: `migrations/0001_init.sql`
- Create: `src/db.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Create the database schema for run history and post push state**

```sql
CREATE TABLE IF NOT EXISTS digest_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  candidate_count INTEGER NOT NULL,
  item_count INTEGER NOT NULL,
  ai_analysis INTEGER NOT NULL,
  message_text TEXT NOT NULL,
  analysis_text TEXT,
  detailed_report_url TEXT,
  source_items_json TEXT NOT NULL,
  feishu_push_ok INTEGER NOT NULL DEFAULT 0,
  push_error TEXT
);

CREATE TABLE IF NOT EXISTS post_push_state (
  post_id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL,
  last_title TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  last_pushed_at TEXT,
  content_fingerprint TEXT NOT NULL,
  last_run_id TEXT
);
```

- [ ] **Step 2: Implement DB helpers for inserting runs and reading/upserting post state**

```ts
export async function upsertPostPushState(db: D1Database, input: PostPushStateRecord): Promise<void> {
  await db.prepare(`INSERT INTO post_push_state (post_id, canonical_url, last_title, last_seen_at, last_active_at, last_pushed_at, content_fingerprint, last_run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_id) DO UPDATE SET
      canonical_url = excluded.canonical_url,
      last_title = excluded.last_title,
      last_seen_at = excluded.last_seen_at,
      last_active_at = excluded.last_active_at,
      last_pushed_at = excluded.last_pushed_at,
      content_fingerprint = excluded.content_fingerprint,
      last_run_id = excluded.last_run_id`).bind(
    input.postId,
    input.canonicalUrl,
    input.lastTitle,
    input.lastSeenAt,
    input.lastActiveAt,
    input.lastPushedAt ?? null,
    input.contentFingerprint,
    input.lastRunId ?? null
  ).run();
}
```

- [ ] **Step 3: Implement the Worker fetch/scheduled entrypoint and fallback logic**

```ts
async function runBrief(env: Env): Promise<{ candidateCount: number; itemCount: number; aiAnalysis: boolean; detailedReportUrl?: string }> {
  const config = parseConfig(env);
  const state = await getRuntimeState(env.RUNTIME_KV);
  const now = new Date();
  const snapshot = await fetchTaogubaSnapshot(config, now);
  const selected = pickPostsForDigest(snapshot.items, config.maxPostsPerDigest);
  // fetch details, compare fingerprints, generate summary, push Feishu, persist D1/KV
}
```

- [ ] **Step 4: Run the full suite and confirm GREEN**

Run: `npm run check`
Expected: PASS

### Task 6: Wire secrets, verify locally, and commit the first working code

**Files:**
- Modify: `.dev.vars`
- Modify: `README.md`
- Modify: any files from Tasks 1-5 as required by verification fixes

- [ ] **Step 1: Write local-only development secrets without committing them**

```env
FEISHU_WEBHOOK=<user-provided webhook>
FEISHU_SECRET=<user-provided secret>
TGB_COOKIE=<user-provided cookie>
```

- [ ] **Step 2: Run a local health verification**

Run: `npx wrangler dev --test-scheduled --port 8787`
Expected: local worker starts

Run: `curl http://127.0.0.1:8787/health`
Expected: JSON with `ok: true`

- [ ] **Step 3: Commit and push the first working implementation**

```bash
git add .
git commit -m "Ship the first Taoguba hot-topics Worker implementation

This adds the first runnable worker version for scraping Taoguba hot-topic pages, generating a summary, and delivering the result through the same Worker-first architecture already used for the Jinshi brief project.

Constraint: Must keep the implementation close to the existing Jinshi worker delivery pattern
Constraint: Feishu webhook, Feishu secret, and TGB cookie must stay out of git-tracked files
Rejected: Rewrite with browser automation | Too heavy for the first Worker release
Confidence: medium
Scope-risk: moderate
Reversibility: clean
Directive: If Taoguba changes list/detail markup, update parser fixtures before changing the parser
Tested: npm run check; local wrangler health verification
Not-tested: Live scheduled run against production Cloudflare bindings"

git push -u origin feature/initial-worker
```
