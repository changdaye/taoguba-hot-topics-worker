# 淘股吧热帖监控 Worker 设计文档

## 概述

`taoguba-hot-topics-worker` 是一个基于 **Cloudflare Workers + D1 + KV + Workers AI** 的淘股吧社区热帖监控项目。

项目整体实现方式对齐 `jinshi-market-brief-worker`：定时抓取网页公开内容并结合登录态 Cookie 提升抓取稳定性，抽取首页推荐区与 `https://www.tgb.cn/bbs/` 主列表中的热点帖子，进入帖子详情页提取首帖与代表性回帖，用 Cloudflare Workers AI 生成社区热度摘要，推送到飞书，并输出详细版 Markdown 报告到对象存储。

## 目标

每 3 小时生成一次淘股吧热帖简报，帮助快速了解：

- 当前社区主要在讨论哪些股票、题材、情绪与分歧
- 哪些帖子值得关注
- 高频提及代码与交易线索

## 范围

### 抓取范围

- 首页推荐/今日内容区：`https://www.tgb.cn/`
- 论坛主列表：`https://www.tgb.cn/bbs/`
- 全链路请求默认携带登录 Cookie，但 Cookie 仅作为密钥存储，不写死到代码仓库

### 内容深度

每轮候选帖经过去重与排序后，最多选取 12 篇帖子进入详情抓取。

每篇帖子提取：

- 帖子标题、作者、URL、列表元信息
- 首帖正文
- 部分回帖内容，按“最新 + 热门/高代表性”混合采样

### 输出范围

- 飞书精简短消息
- COS 详细版 Markdown 报告
- D1 历史记录与防重复推送状态
- KV 运行状态、心跳、失败告警状态

## 非目标

以下内容不在第一版范围内：

- 全站实时流式监控
- 浏览器渲染抓取
- 私信、关注流、个人主页动态监控
- 全量楼层抓取与深层分页回帖采集
- 对用户提供的 Cookie 做自动刷新或登录续期

## 总体架构

1. Cloudflare Worker 按 cron 每 3 小时运行一次
2. 抓取首页推荐区与 `/bbs/` 主列表
3. 归一化为统一候选帖子结构 `PostCandidate`
4. 基于帖子 ID、标准化 URL 等规则去重
5. 按优先级排序后选取前 12 篇
6. 进入帖子详情提取首帖正文与代表性回帖
7. 生成结构化帖子上下文 `DigestSourcePost`
8. 交给 Workers AI 生成中文社区热帖简报
9. 生成飞书短消息与详细版 Markdown 报告
10. 报告上传到 COS；短消息推送飞书；运行结果写入 D1 与 KV

## 数据流设计

### 候选帖子抽象

列表页统一转换为如下逻辑结构：

- `postId`
- `canonicalUrl`
- `title`
- `authorName`
- `source`（`home` / `bbs`）
- `replyCount`
- `lastActiveAt`
- `sourceRank`
- `sourceLabel`

### 详情页抽象

详情页统一转换为：

- `postId`
- `canonicalUrl`
- `title`
- `authorName`
- `publishedAt`
- `lastActiveAt`
- `headContent`
- `sampledReplies[]`
- `mentionedTickers[]`
- `rawMetrics`

### LLM 输入抽象

每篇帖子进入 LLM 前将裁剪为固定格式，避免提示过长：

- 帖子标题
- 作者
- 首帖核心内容摘要
- 代表性回帖若干条
- 互动/活跃度线索
- 自动提取的可能代码

## 去重与排序规则

### 双源去重

优先级按以下顺序：

1. `postId`
2. 标准化 URL
3. `标题 + 作者` 兜底

### 排序逻辑

候选帖子排序不是单纯按抓到顺序，而是综合：

- 首页推荐区加权
- `/bbs/` 列表靠前帖子加权
- 最近活跃时间越近越优先
- 回帖数、活跃度高的帖子优先
- 明显老帖、低互动帖向后排

最终仅保留前 12 篇进入详情抓取。

## 防重复推送策略

目标是“尽量避免重复推送”，而不是永久不重复。

### 基本规则

D1 记录每个帖子最近一次推送状态：

- 最近推送时间
- 最近看到的标题
- 最近活跃时间
- 最近一次内容指纹
- 最近一次所属 run id

### 内容指纹

指纹由以下信息组合得到：

- 标题
- 首帖正文归一化摘要
- 本轮采样回帖归一化摘要
- 最近活跃时间

### 重推判定

如果帖子仍在榜单中但内容变化极小，则跳过；只有以下情况之一成立时才允许再次进入本轮摘要：

- 新增了明显不同的回帖观点
- 最近活跃时间显著推进
- 帖子热度、讨论方向出现明显变化
- 距离上次推送已超过兜底冷却窗口

## 回帖采样策略

每篇帖子默认做有限采样，避免过度抓取与超长上下文。

### 采样组成

- 一部分最新回帖：保证时效
- 一部分更具代表性的高信息密度回帖：保证观点浓度

### 清洗规则

过滤以下内容：

- 纯表情、纯标点、纯引用
- 明显灌水与重复回复
- 与主题无关的短噪声文本
- 过长但低信息密度的冗余段落

### 采样目标

让最终摘要更像“这篇帖子在讨论什么、主要分歧点是什么、当前情绪如何”，而不是简单罗列楼层。

## 飞书消息设计

沿用当前 Worker 项目约定：

- 不显示顶部标题
- 不显示时间
- 不显示源帖链接
- 保留“关注代码”与精简摘要

若生成详细版报告，在消息末尾追加：

```text
详细版报告:
<URL>
```

### 短消息目标风格

- 先写 2~4 句总览：本轮淘股吧主线、情绪、主要分歧
- 再提炼重点方向
- 末尾给出 `关注代码：xxx、yyy、zzz`

## 详细版 Markdown 报告

报告默认上传到对象存储，命名规则沿用现有约定：

- key 前缀：项目目录名 `taoguba-hot-topics-worker`
- 文件名：UTC 年月日时分秒

### 报告结构

1. 本轮总览
2. 社区主线 / 情绪判断
3. 重点热帖逐条拆解（最多 12 篇）
   - 标题
   - 作者
   - 原帖链接
   - 首帖核心观点
   - 代表性回帖观点
   - 提炼出的交易线索 / 风险点
4. 高频提及代码
5. 观察到的分歧点

## 存储设计

### D1 表

#### `digest_runs`

记录每轮任务执行信息：

- run id
- 创建时间
- 抓取候选数
- 入选帖子数
- AI 是否成功
- 飞书消息正文
- 详细版报告 URL
- 推送是否成功
- 错误信息

#### `post_push_state`

记录帖子级防重复推送状态：

- `post_id`
- `canonical_url`
- `last_title`
- `last_seen_at`
- `last_active_at`
- `last_pushed_at`
- `content_fingerprint`
- `last_run_id`

### KV 键

KV 用于轻量运行状态：

- 最近成功时间
- 最近失败时间
- 最近心跳时间
- 连续失败次数
- 失败告警冷却
- 最近错误摘要
- 夜间静默累计（如启用静默策略）

## 错误处理与容错

### 列表页容错

- 首页失败但 `/bbs/` 成功：继续产出
- `/bbs/` 失败但首页成功：继续产出
- 双源都无有效帖子：本轮失败

### 详情页容错

- 单篇帖子详情抓取失败不拖垮整轮
- 可退化为仅使用列表信息或直接跳过该帖

### 登录态 / 反爬异常

以下情况视为抓取异常：

- 返回登录失效页
- 返回反爬页
- 返回空白页或异常跳转页
- 页面结构缺失核心块导致无法提取

### LLM 兜底

若 Workers AI 失败，使用规则模板拼接 fallback 简报，保证“抓到内容就尽量有结果”。

## 配置与密钥

### 环境变量

计划新增或沿用以下配置：

- `DIGEST_INTERVAL_HOURS=3`
- `HEARTBEAT_INTERVAL_HOURS`
- `REQUEST_TIMEOUT_MS`
- `FETCH_WINDOW_HOURS`
- `MAX_POSTS_PER_DIGEST=12`
- `MAX_REPLIES_PER_POST`
- `LLM_MODEL`
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
- `TENCENT_COS_BASE_URL`（可选）

## 模型与部署约束

- 默认优先使用已验证可用的 **Cloudflare Workers AI 模型**
- 不把淘股吧 Cookie 写入仓库或日志
- 保留健康检查、手动触发、心跳、失败告警机制
- 夜间静默若启用，仅影响正常报告，不影响心跳消息

## 测试策略

### 解析测试

- 首页推荐区 HTML fixture 解析测试
- `/bbs/` 主列表 HTML fixture 解析测试
- 帖子详情页首帖解析测试
- 回帖解析与混合采样测试

### 规则测试

- 双源去重测试
- 前 12 篇排序筛选测试
- 内容指纹与防重复推送测试
- fallback 消息格式测试
- 详细版报告格式测试

### 集成测试

- 模拟完整 run：抓取结果 -> 摘要生成 -> 消息输出 -> D1/KV 写入

## 项目基础设施

新建 Git 项目时默认补齐标准基础设施：

- `README.md`
- `LICENSE`
- `.editorconfig`
- `.gitignore`
- `.github/`
- `wrangler.jsonc`
- `migrations/`
- `src/`
- `test/`
- `.dev.vars.example`

项目结构尽量对齐 `jinshi-market-brief-worker`，仅替换为淘股吧抓取、抽取、提示词与报告逻辑。

## GitHub 仓库要求

- 创建公开远端仓库：`taoguba-hot-topics-worker`
- 本地仓库与远端仓库保持同名
- 在实现完成初期即进行至少一次提交并推送
- 提交信息遵循 Lore Commit Protocol

## 风险

- 页面结构变化会直接影响解析逻辑
- 登录态 Cookie 可能失效
- 某些帖子或回帖页面可能存在反爬或内容缺失
- 代码提取依赖中文文本规则，可能出现噪声
- LLM 摘要质量受上下文质量影响

## 成功标准

满足以下条件则视为第一版达标：

- 能稳定从首页与 `/bbs/` 双源抓到候选帖子
- 能对前 12 篇帖子完成详情提取与回帖采样
- 能生成可读的飞书热帖简报
- 能上传详细版报告到 COS
- 能通过 D1 + KV 实现运行记录与防重复推送
- 能在 Cloudflare Worker 上手动触发与定时运行
