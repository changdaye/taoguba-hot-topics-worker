import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const wranglerConfig = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const exampleEnv = readFileSync(new URL("../.dev.vars.example", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("project LLM configuration", () => {
  it("keeps the default deployed model pointed at the OpenAI-compatible large model", () => {
    expect(wranglerConfig).toContain('"LLM_MODEL": "gpt-5.4"');
  });

  it("documents the optional proxy secrets in the example env file", () => {
    expect(exampleEnv).toContain("LLM_BASE_URL=");
    expect(exampleEnv).toContain("LLM_API_KEY=");
  });

  it("documents the proxy secrets in the README", () => {
    expect(readme).toContain("LLM_BASE_URL");
    expect(readme).toContain("LLM_API_KEY");
  });
});
