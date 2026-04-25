import type { BriefConfig, DigestSourcePost, LLMAnalysisResult } from "../types";
import { truncate } from "../lib/value";

const SYSTEM_PROMPT = `你现在是一名中文A股社区观察员。
你的任务是把淘股吧热帖讨论整理成一条“短线决策辅助简报”。

严格要求：
- 严格只输出四行，且必须按下面格式：
- 出手判断：...
- 方向判断：...
- 关注代码：...
- 风险提醒：...
- “出手判断”只能写偏交易决策的话，例如：观望为主、轻仓试错、只做最强、不可追高。
- “方向判断”聚焦 2 到 4 个最值得盯的板块/风格，不要空泛复述。
- 如果没有明确代码，就写“关注代码：暂无明确高频代码”。
- 关注代码优先写股名，可混合少量证券代码，但不要超过 8 个。
- 不要输出编号列表，不要逐条罗列帖子标题。
- 不要输出时间、原帖链接、素材字段名。
- 风格像盘中/复盘简报，而不是聊天，也不要写免责声明。`;
const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.2-1b-instruct";
const OPENAI_COMPAT_REASONING_EFFORT = "xhigh";

interface WorkersAIResult {
  response?: string;
}

interface OpenAICompatResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

export async function analyzeWithLLM(config: BriefConfig, ai: Ai, posts: DigestSourcePost[]): Promise<LLMAnalysisResult> {
  const directionSummary = summarizeDirections(posts);
  const watchlistSummary = summarizeWatchlist(posts);
  const sourceText = posts
    .slice(0, 8)
    .map((post, index) => {
      const lines = [
        `${index + 1}. 标题: ${truncate(post.title, 72)}`,
        `   作者: ${post.authorName}`,
        `   来源: ${post.sourceLabel}`,
        `   首帖: ${truncate(post.headContent, 220)}`
      ];
      if (post.sampledReplies.length > 0) lines.push(`   回帖: ${truncate(post.sampledReplies.slice(0, 2).join(" / "), 120)}`);
      if (post.mentionedTickers.length > 0) lines.push(`   代码: ${post.mentionedTickers.join("、")}`);
      return lines.join("\n");
    })
    .join("\n");
  const contextText = [
    `高频方向候选: ${directionSummary}`,
    `高频代码候选: ${watchlistSummary}`,
    "请优先根据“最新复盘/盘前/情绪/板块切换/节点识别”类内容做决策判断，弱化泛交流、纯鸡汤、长期成长帖。"
  ].join("\n");

  if (config.llmBaseUrl && config.llmApiKey) {
    try {
      return await analyzeWithOpenAICompatible(config, `${contextText}\n\n${sourceText}`);
    } catch (error) {
      console.error("OpenAI-compatible LLM failed", error instanceof Error ? error.message : String(error));
    }
  }

  return analyzeWithWorkersAI(ai, config.llmModel.startsWith("@cf/") ? config.llmModel : DEFAULT_WORKERS_AI_MODEL, `${contextText}\n\n${sourceText}`);
}

async function analyzeWithOpenAICompatible(config: BriefConfig, sourceText: string): Promise<LLMAnalysisResult> {
  const response = await fetch(`${config.llmBaseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llmApiKey}`,
    },
    body: JSON.stringify({
      model: config.llmModel,
      reasoning_effort: OPENAI_COMPAT_REASONING_EFFORT,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `以下是淘股吧热帖与回帖内容，请输出一份飞书热度简报：\n\n${sourceText}` }
      ],
      max_tokens: 500,
      temperature: 0.2
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI-compatible HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const result = (await response.json()) as OpenAICompatResponse;
  const rawContent = result.choices?.[0]?.message?.content;
  const content = typeof rawContent === "string" ? rawContent.trim() : rawContent?.map((part) => part.text ?? "").join("").trim();
  if (!content) throw new Error("OpenAI-compatible response returned empty content");
  return {
    analysis: content,
    modelLabel: `${formatModelLabel(config.llmModel)} (${OPENAI_COMPAT_REASONING_EFFORT})`,
  };
}

async function analyzeWithWorkersAI(ai: Ai, model: string, sourceText: string): Promise<LLMAnalysisResult> {
  const result = (await ai.run(model, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `以下是淘股吧热帖与回帖内容，请输出一份飞书热度简报：\n\n${sourceText}` }
    ],
    max_tokens: 500,
    temperature: 0.2
  })) as WorkersAIResult;

  const content = result.response?.trim();
  if (!content) throw new Error("Workers AI returned empty response");
  return {
    analysis: content,
    modelLabel: formatModelLabel(model),
  };
}

function formatModelLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "Unknown";
  const slug = trimmed.replace(/^@cf\//, "").split("/").pop() ?? trimmed;
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "gpt") return "GPT";
      if (lower === "llama") return "Llama";
      if (lower === "qwen") return "Qwen";
      if (lower === "gemma") return "Gemma";
      if (lower === "glm") return "GLM";
      if (lower === "mistral") return "Mistral";
      if (lower === "kimi") return "Kimi";
      if (lower === "deepseek") return "DeepSeek";
      if (lower === "fp8") return "FP8";
      if (lower === "awq") return "AWQ";
      if (lower === "it") return "IT";
      if (/^\d+(\.\d+)?b$/i.test(part)) return part.toUpperCase();
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function summarizeDirections(posts: DigestSourcePost[]): string {
  const joined = posts.flatMap((post) => [post.title, post.headContent, ...post.sampledReplies]).join("\n");
  const rules = [
    { label: "国产算力/GPU", keywords: ["算力", "GPU", "寒武纪", "中国长城", "富瀚微", "深圳华强"] },
    { label: "光通信/CPO", keywords: ["光模块", "CPO", "中际旭创", "新易盛", "杭电股份", "亨通光电"] },
    { label: "AI应用", keywords: ["AI应用", "浙数文化", "传媒", "应用"] },
    { label: "电力绿能", keywords: ["电力", "储能", "绿能", "晶科科技", "华电"] },
    { label: "情绪修复/首板", keywords: ["首板", "弱转强", "反核", "修复", "节点", "连板"] }
  ];
  const picks = rules.filter((rule) => rule.keywords.some((keyword) => joined.includes(keyword))).map((rule) => rule.label).slice(0, 4);
  return picks.length > 0 ? picks.join("、") : "短线情绪修复与板块轮动";
}

function summarizeWatchlist(posts: DigestSourcePost[]): string {
  const counts = new Map<string, number>();
  for (const token of posts.flatMap((post) => post.mentionedTickers)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .map(([token]) => token)
    .slice(0, 8)
    .join("、") || "暂无明确高频代码";
}
