import { describe, expect, it } from "vitest";
import { buildDetailedReportPublicUrl, maybeHandleDetailedReportRequest, saveDetailedReportCopy } from "../src/lib/report-storage";

class FakeKV {
  private readonly data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
}

describe("report storage", () => {
  it("builds nested public report URLs on the worker domain", () => {
    expect(buildDetailedReportPublicUrl("https://demo.example.workers.dev/", "sample-worker/20260426010101.html"))
      .toBe("https://demo.example.workers.dev/reports/sample-worker/20260426010101.html");
  });

  it("serves saved HTML reports from the report route", async () => {
    const kv = new FakeKV() as unknown as KVNamespace;
    await saveDetailedReportCopy(kv, "sample-worker/20260426010101.html", "<h1>report</h1>");

    const response = await maybeHandleDetailedReportRequest(
      new Request("https://demo.example.workers.dev/reports/sample-worker/20260426010101.html"),
      kv,
    );

    expect(response?.status).toBe(200);
    await expect(response?.text()).resolves.toBe("<h1>report</h1>");
    expect(response?.headers.get("content-type")).toContain("text/html");
  });
});
