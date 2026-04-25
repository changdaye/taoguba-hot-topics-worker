import { parseConfig } from "./config";
import { getPostPushState, insertDigestRun, listRecentDigestRuns, markDigestRunPushed, upsertPostPushState } from "./db";
import { authorizeAdminRequest } from "./lib/admin";
import { buildDigestMessage, buildFailureAlertMessage, buildFallbackMessage, buildHeartbeatMessage, buildWakeSummaryMessage } from "./lib/message";
import { buildDetailedReport } from "./lib/report";
import { getRuntimeState, recordFailure, recordSuccess, setRuntimeState, shouldSendFailureAlert, shouldSendHeartbeat } from "./lib/runtime";
import { clearQuietDigest, isDigestQuietHours, noteQuietDigest } from "./lib/schedule";
import { uploadDetailedReportToCos } from "./services/cos";
import { pushToFeishu } from "./services/feishu";
import { analyzeWithLLM } from "./services/llm";
import { buildPostFingerprint, fetchPostDetails, fetchTaogubaSnapshot, pickPostsForDigest, shouldRepushPost } from "./services/taoguba";
import type { BriefConfig, DigestSourcePost, Env, RuntimeState } from "./types";

async function runBrief(env: Env): Promise<{ candidateCount: number; itemCount: number; aiAnalysis: boolean; detailedReportUrl?: string; skipped?: boolean }> {
  const config = parseConfig(env);
  const state = await getRuntimeState(env.RUNTIME_KV);
  const now = new Date();
  const quietHours = isDigestQuietHours(now);

  try {
    const snapshot = await fetchTaogubaSnapshot(config, now);
    if (snapshot.items.length === 0) {
      throw new Error("Taoguba snapshot returned no items");
    }

    const selected = pickPostsForDigest(snapshot.items, config.maxPostsPerDigest);
    const detailedPosts = await fetchPostDetails(config, selected, now);
    const postsToPush = await filterRepushablePosts(env, detailedPosts, now);

    if (postsToPush.length === 0) {
      const nextState = recordSuccess(state, now);
      await setRuntimeState(env.RUNTIME_KV, nextState);
      return { candidateCount: snapshot.items.length, itemCount: 0, aiAnalysis: false, skipped: true };
    }

    let analysis: string | undefined;
    let modelLabel = "";
    let aiAnalysis = false;
    try {
      const llmResult = await analyzeWithLLM(config, env.AI, postsToPush);
      analysis = llmResult.analysis;
      modelLabel = llmResult.modelLabel;
      aiAnalysis = true;
    } catch (error) {
      console.error("LLM analyze failed", error instanceof Error ? error.message : String(error));
    }

    const detailedReport = buildDetailedReport(analysis ?? buildFallbackMessage(postsToPush), postsToPush, aiAnalysis, now);
    const uploaded = await uploadDetailedReportToCos(config, detailedReport, now);
    const baseMessage = aiAnalysis
      ? buildDigestMessage(analysis ?? "", postsToPush, uploaded.url, modelLabel)
      : buildFallbackMessage(postsToPush, uploaded.url, modelLabel);
    const message = !quietHours && (state.quietDigestCount ?? 0) > 0
      ? buildWakeSummaryMessage(baseMessage, state.quietDigestCount ?? 0)
      : baseMessage;

    const runId = crypto.randomUUID();
    await insertDigestRun(env.BRIEF_DB, {
      id: runId,
      source: "taoguba web snapshot",
      candidateCount: snapshot.items.length,
      itemCount: postsToPush.length,
      aiAnalysis,
      messageText: message,
      analysisText: analysis,
      detailedReportUrl: uploaded.url,
      sourceItems: postsToPush,
      now
    });

    let nextState = recordSuccess(state, now);
    if (quietHours) {
      nextState = noteQuietDigest(nextState, now);
      await persistPostStates(env, postsToPush, runId, now);
      await markDigestRunPushed(env.BRIEF_DB, runId, true);
      await maybeSendHeartbeat(config, nextState, now);
      await setRuntimeState(env.RUNTIME_KV, nextState);
      return { candidateCount: snapshot.items.length, itemCount: postsToPush.length, aiAnalysis, detailedReportUrl: uploaded.url };
    }

    try {
      await pushToFeishu(config, message);
      await persistPostStates(env, postsToPush, runId, now);
      await markDigestRunPushed(env.BRIEF_DB, runId, true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await markDigestRunPushed(env.BRIEF_DB, runId, false, errorMessage);
      throw error;
    }

    if ((nextState.quietDigestCount ?? 0) > 0) {
      nextState = clearQuietDigest(nextState);
    }
    nextState = await maybeSendHeartbeat(config, nextState, now);
    await setRuntimeState(env.RUNTIME_KV, nextState);
    return { candidateCount: snapshot.items.length, itemCount: postsToPush.length, aiAnalysis, detailedReportUrl: uploaded.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let nextState = recordFailure(state, message, now);
    if (shouldSendFailureAlert(nextState, config.failureAlertThreshold, config.failureAlertCooldownMinutes, now)) {
      try {
        await pushToFeishu(config, buildFailureAlertMessage(nextState, config.failureAlertThreshold));
        nextState = { ...nextState, lastAlertAt: now.toISOString() };
      } catch {
        // Keep the original failure as the primary signal.
      }
    }
    await setRuntimeState(env.RUNTIME_KV, nextState);
    throw error;
  }
}

async function filterRepushablePosts(env: Env, posts: DigestSourcePost[], now: Date): Promise<DigestSourcePost[]> {
  const accepted: DigestSourcePost[] = [];
  for (const post of posts) {
    const fingerprint = buildPostFingerprint(post);
    const previous = await getPostPushState(env.BRIEF_DB, post.id);
    if (shouldRepushPost(previous, { contentFingerprint: fingerprint }, now)) {
      accepted.push(post);
    }
  }
  return accepted;
}

async function persistPostStates(env: Env, posts: DigestSourcePost[], runId: string, now: Date): Promise<void> {
  for (const post of posts) {
    await upsertPostPushState(env.BRIEF_DB, {
      postId: post.id,
      canonicalUrl: post.canonicalUrl,
      lastTitle: post.title,
      lastSeenAt: now.toISOString(),
      lastActiveAt: post.lastActiveAt,
      lastPushedAt: now.toISOString(),
      contentFingerprint: buildPostFingerprint(post),
      lastRunId: runId
    });
  }
}

async function maybeSendHeartbeat(config: BriefConfig, state: RuntimeState, now: Date): Promise<RuntimeState> {
  if (shouldSendHeartbeat(state, config.heartbeatIntervalHours, now)) {
    try {
      await pushToFeishu(config, buildHeartbeatMessage(state, config.heartbeatIntervalHours));
      return { ...state, lastHeartbeatAt: now.toISOString() };
    } catch {
      return state;
    }
  }
  return state;
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return Response.json(data, { status });
}

async function buildHealthResponse(env: Env): Promise<Record<string, unknown>> {
  const runtimeState: RuntimeState = await getRuntimeState(env.RUNTIME_KV);
  const recentRuns = await listRecentDigestRuns(env.BRIEF_DB, 5);
  return {
    ok: true,
    worker: "taoguba-hot-topics-worker",
    runtimeState,
    recentRuns
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return jsonResponse(await buildHealthResponse(env));
    }

    if (request.method === "POST" && url.pathname === "/admin/trigger") {
      const config = parseConfig(env);
      const auth = authorizeAdminRequest(request, config.manualTriggerToken);
      if (!auth.ok) {
        return jsonResponse({ ok: false, error: auth.error }, auth.status);
      }
      try {
        const result = await runBrief(env);
        return jsonResponse({ ok: true, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResponse({ ok: false, error: message }, 500);
      }
    }

    return jsonResponse({ ok: false, error: "not found" }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runBrief(env);
  }
};
