import { describe, expect, it } from "vitest";
import { clearQuietDigest, getShanghaiHour, isDigestQuietHours, noteQuietDigest } from "../src/lib/schedule";

describe("isDigestQuietHours", () => {
  it("treats 22:00-07:59 Asia/Shanghai as quiet hours", () => {
    expect(isDigestQuietHours(new Date("2026-04-25T14:30:00Z"))).toBe(true);
    expect(isDigestQuietHours(new Date("2026-04-24T23:30:00Z"))).toBe(true);
    expect(isDigestQuietHours(new Date("2026-04-25T00:00:00Z"))).toBe(false);
  });

  it("reports Shanghai local hour correctly", () => {
    expect(getShanghaiHour(new Date("2026-04-25T00:00:00Z"))).toBe(8);
  });
});

describe("quiet digest state", () => {
  it("accumulates quiet digest counts", () => {
    const first = noteQuietDigest({ consecutiveFailures: 0 }, new Date("2026-04-25T14:00:00Z"));
    const second = noteQuietDigest(first, new Date("2026-04-25T16:00:00Z"));
    expect(second.quietDigestCount).toBe(2);
  });

  it("clears quiet digest markers", () => {
    const state = clearQuietDigest({
      consecutiveFailures: 0,
      quietDigestCount: 3,
      quietDigestStartedAt: "2026-04-25T14:00:00.000Z",
      quietDigestLastAt: "2026-04-25T16:00:00.000Z"
    });
    expect(state.quietDigestCount).toBe(0);
  });
});
