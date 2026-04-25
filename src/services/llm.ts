import type { BriefConfig, DigestSourcePost, LLMAnalysisResult } from "../types";
import { truncate } from "../lib/value";

const SYSTEM_PROMPT = `你现在是一名中文A股社区观察员。
你的任务是把淘股吧热帖讨论整理成一条飞书社区热度简报。

严格要求：
- 只输出两部分：先写2到4句“总览”，最后单独一行写“关注代码：...”。
- 如果没有明确代码，就写“关注代码：暂无明确高频代码”。
- 不要输出编号列表，不要逐条罗列帖子标题。
- 不要输出时间、原帖链接、素材字段名。
- 风格像盘中/复盘简报，而不是聊天。`;
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

  if (config.llmBaseUrl && config.llmApiKey) {
    try {
      return await analyzeWithOpenAICompatible(config, sourceText);
    } catch (error) {
      console.error("OpenAI-compatible LLM failed", error instanceof Error ? error.message : String(error));
    }
  }

  return analyzeWithWorkersAI(ai, config.llmModel.startsWith("@cf/") ? config.llmModel : DEFAULT_WORKERS_AI_MODEL, sourceText);
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
