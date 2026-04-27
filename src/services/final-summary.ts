import type { BriefConfig, Env } from "../types";
import { fetchCosObjectText, listCosObjects, uploadFinalSummaryToCos } from "./cos";
import { pushToFeishu } from "./feishu";

interface FinalSummaryResult {
  key: string;
  url: string;
  content: string;
  includedCount: number;
  modelLabel: string;
}

function parseTimestampFromKey(key: string): number | null {
  const matched = key.match(/(\d{14})\.txt$/);
  if (!matched) return null;
  const stamp = matched[1];
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z`;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

function buildPrompt(messages: string[]): string {
  return messages.map((message, index) => `消息 ${index + 1}:\n${message}`).join("\n\n");
}

async function summarizeWithLLM(config: BriefConfig, ai: Ai | undefined, messages: string[]): Promise<{ content: string; modelLabel: string }> {
  const fallback = ["【凌晨总结】", `过去 ${messages.length} 条飞书消息已归档。`, "【简述】", messages.slice(0, 3).map((message, index) => `${index + 1}. ${message.split("\n")[0] ?? message}`).join("\n")].join("\n\n");
  const systemPrompt = "你是一名中文财经编辑。请基于多条飞书短消息，输出一份精简的凌晨总结。不要 markdown 表格，使用自然中文分段，保留“【凌晨总结】”“【核心脉络】”“【主要风险】”三个小节。";
  const payload = buildPrompt(messages);
  if (config.llmBaseUrl && config.llmApiKey) {
    try {
      const response = await fetch(`${config.llmBaseUrl.replace(/\/+$/, "")}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.llmApiKey}` }, body: JSON.stringify({ model: config.llmModel, reasoning_effort: "xhigh", max_completion_tokens: 500, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: payload }], temperature: 0.2 }) });
      if (response.ok) {
        const result = await response.json() as any;
        const raw = result.choices?.[0]?.message?.content;
        const content = typeof raw === "string" ? raw.trim() : raw?.map((part: any) => part.text ?? "").join("").trim();
        if (content) return { content, modelLabel: `${config.llmModel} (xhigh)` };
      }
    } catch (error) {
      console.error("Final summary proxy LLM failed", error);
    }
  }
  if (!ai) return { content: fallback, modelLabel: "" };
  try {
    const result = await ai.run(config.llmModel.startsWith("@cf/") ? config.llmModel : "@cf/meta/llama-3.2-1b-instruct", { messages: [{ role: "system", content: systemPrompt }, { role: "user", content: payload }], max_tokens: 500, temperature: 0.2 }) as any;
    const content = result.response?.trim();
    return content ? { content, modelLabel: config.llmModel.startsWith("@cf/") ? config.llmModel : "Llama 3.2 1B Instruct" } : { content: fallback, modelLabel: "" };
  } catch (error) {
    console.error("Final summary Workers AI failed", error);
    return { content: fallback, modelLabel: "" };
  }
}

export async function runFinalSummary(env: Env, config: BriefConfig, now = new Date()): Promise<FinalSummaryResult | null> {
  const prefix = "taoguba-hot-topics-worker/feishu-messages/";
  const objects = await listCosObjects(config, prefix);
  const cutoff = now.getTime() - config.finalSummaryLookbackHours * 60 * 60 * 1000;
  const recent = objects.map((item) => ({ ...item, timestamp: parseTimestampFromKey(item.key) })).filter((item): item is typeof item & { timestamp: number } => item.timestamp != null && item.timestamp >= cutoff).sort((a, b) => a.timestamp - b.timestamp);
  if (!recent.length) return null;
  const messages = await Promise.all(recent.map((item) => fetchCosObjectText(config, item.key)));
  const llm = await summarizeWithLLM(config, env.AI, messages);
  const header = ["【凌晨总结】", `生成时间：${now.toISOString()}`, `纳入消息数：${messages.length}`, llm.modelLabel ? `模型：${llm.modelLabel}` : undefined, "", llm.content].filter(Boolean).join("\n");
  const uploaded = await uploadFinalSummaryToCos(config, header, now);
  const feishuText = ["【凌晨总结已生成】", `纳入消息数：${messages.length}`, llm.modelLabel ? `模型：${llm.modelLabel}` : undefined, "", "详细版存档:", uploaded.url].filter(Boolean).join("\n");
  await pushToFeishu(config, feishuText);
  return { key: uploaded.key, url: uploaded.url, content: header, includedCount: messages.length, modelLabel: llm.modelLabel };
}
