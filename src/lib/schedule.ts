import type { RuntimeState } from "../types";

export function isDigestQuietHours(now = new Date()): boolean {
  const hour = getShanghaiHour(now);
  return hour >= 22 || hour < 8;
}

export function getShanghaiHour(now = new Date()): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: "Asia/Shanghai",
  });
  return Number(formatter.format(now));
}

export function noteQuietDigest(state: RuntimeState, now = new Date()): RuntimeState {
  const iso = now.toISOString();
  return {
    ...state,
    quietDigestCount: (state.quietDigestCount ?? 0) + 1,
    quietDigestStartedAt: state.quietDigestStartedAt ?? iso,
    quietDigestLastAt: iso,
  };
}

export function clearQuietDigest(state: RuntimeState): RuntimeState {
  return {
    ...state,
    quietDigestCount: 0,
    quietDigestStartedAt: undefined,
    quietDigestLastAt: undefined,
  };
}
