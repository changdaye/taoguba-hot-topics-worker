import type { RuntimeState } from "../types";

const KEY = "runtime_state";

export async function getRuntimeState(kv: KVNamespace): Promise<RuntimeState> {
  const raw = await kv.get(KEY);
  if (!raw) return { consecutiveFailures: 0 };
  return JSON.parse(raw) as RuntimeState;
}

export async function setRuntimeState(kv: KVNamespace, state: RuntimeState): Promise<void> {
  await kv.put(KEY, JSON.stringify(state));
}

export function recordSuccess(state: RuntimeState, now = new Date()): RuntimeState {
  return {
    ...state,
    lastSuccessAt: now.toISOString(),
    lastError: undefined,
    consecutiveFailures: 0
  };
}

export function recordFailure(state: RuntimeState, error: string, now = new Date()): RuntimeState {
  return {
    ...state,
    lastFailureAt: now.toISOString(),
    lastError: error,
    consecutiveFailures: state.consecutiveFailures + 1
  };
}

export function shouldSendHeartbeat(state: RuntimeState, intervalHours: number, now = new Date()): boolean {
  return shouldSendAtInterval(state.lastHeartbeatAt, intervalHours, now);
}

export function shouldSendFailureAlert(state: RuntimeState, threshold: number, cooldownMinutes: number, now = new Date()): boolean {
  if (state.consecutiveFailures < threshold) return false;
  if (!state.lastAlertAt) return true;
  const lastAlertAt = Date.parse(state.lastAlertAt);
  if (Number.isNaN(lastAlertAt)) return true;
  return now.getTime() >= lastAlertAt + cooldownMinutes * 60 * 1000;
}

function shouldSendAtInterval(iso: string | undefined, intervalHours: number, now: Date): boolean {
  if (!iso) return true;
  const previous = Date.parse(iso);
  if (Number.isNaN(previous)) return true;
  return now.getTime() >= previous + intervalHours * 60 * 60 * 1000;
}
