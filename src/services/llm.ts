import type { BriefConfig, DigestSourcePost, LLMAnalysisResult } from "../types";
import { truncate } from "../lib/value";

const SYSTEM_PROMPT = `你是中文A股短线交易助手，只输出四行：
出手判断：...
方向判断：...
观察标的：...
风险提醒：...
规则：出手判断只能四选一（继续观望、轻仓试错、只做最强、不建议出手）；观察标的只写3到5个股名(代码)；拿不准时默认继续观望。`;
const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.2-1b-instruct";
const OPENAI_COMPAT_REASONING_EFFORT = "xhigh";
const OPENAI_COMPAT_MAX_COMPLETION_TOKENS = 180;

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
  const watchlistSummary = summarizeWatchlist(posts);
  const sourceText = posts
    .slice(0, 2)
    .map((post, index) => {
      const lines = [
        `${index + 1}. ${truncate(post.title, 48)}`,
        `活跃:排${post.sourceRank}/回${post.replyCount}`,
        `要点:${truncate(post.headContent, 55)}`
      ];
      if (post.sampledReplies.length > 0) lines.push(`回帖:${truncate(post.sampledReplies[0], 36)}`);
      if (post.mentionedTickers.length > 0) lines.push(`标的:${post.mentionedTickers.slice(0, 4).join("、")}`);
      return lines.join(" | ");
    })
    .join("\n");
  const contextText = [
    `高频标的候选: ${watchlistSummary}`,
    "优先看复盘、盘前计划、板块切换和情绪节点；弱化闲聊贴。"
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
      max_completion_tokens: OPENAI_COMPAT_MAX_COMPLETION_TOKENS,
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

function summarizeWatchlist(posts: DigestSourcePost[]): string {
  const counts = new Map<string, number>();
  for (const token of posts.flatMap((post) => post.mentionedTickers)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .map(([token]) => token)
    .slice(0, 5)
    .join("、") || "暂无明确高频代码";
}
