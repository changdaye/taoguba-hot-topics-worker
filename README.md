# taoguba-hot-topics-worker

一个基于 **Cloudflare Workers + D1 + KV** 的淘股吧热帖简报项目。

它会抓取 `tgb.cn` 首页推荐区与论坛主列表热帖，进入帖子详情提取首帖与代表性回帖，用 **Cloudflare Workers AI** 生成中文社区热度摘要，并推送到飞书。

## 功能

- 每 **3 小时** 定时生成一次热帖简报
- 数据源来自：
  - `https://www.tgb.cn/` 首页推荐区（best-effort）
  - `https://www.tgb.cn/bbs/` 主列表
- 默认全链路携带淘股吧 Cookie 抓取
- 生成飞书短消息
- 额外生成详细版 HTML 报告并上传到腾讯云 COS
- D1 保存运行历史与帖子去重状态
- KV 保存运行状态、心跳与失败告警状态
- 手动触发接口

## 本地开发

```bash
npm install
npm run check
npx wrangler dev
```

## 环境变量

### Wrangler vars

- `DIGEST_INTERVAL_HOURS`
- `HEARTBEAT_INTERVAL_HOURS`
- `REQUEST_TIMEOUT_MS`
- `FETCH_WINDOW_HOURS`
- `MAX_POSTS_PER_DIGEST`
- `MAX_REPLIES_PER_POST`
- `LLM_MODEL`（默认部署值为 `gpt-5.4`，若未配置代理则自动回退到 Workers AI 模型）
- `TGB_HOME_URL`
- `TGB_BBS_URL`
- `FAILURE_ALERT_THRESHOLD`
- `FAILURE_ALERT_COOLDOWN_MINUTES`

### Secrets

- `FEISHU_WEBHOOK`
- `FEISHU_SECRET`
- `MANUAL_TRIGGER_TOKEN`
- `TGB_COOKIE`
- `TENCENT_COS_SECRET_ID`
- `TENCENT_COS_SECRET_KEY`
- `TENCENT_COS_BUCKET`
- `TENCENT_COS_REGION`
- `LLM_BASE_URL`（可选，配置后优先走大模型代理）
- `LLM_API_KEY`（可选，与 `LLM_BASE_URL` 配套）
- `TENCENT_COS_BASE_URL`（可选）
