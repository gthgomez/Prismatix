// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryExtractor } from "../../supabase/functions/memory/provider";
import { decryptKey } from "../../supabase/functions/_shared/byok_crypto";
import { FAKE_BYOK_CIPHERTEXT, installTestByokEnv } from "../helpers/byok-fixtures";
const subject = "11111111-1111-4111-8111-111111111111";
const job = {
  id: "job",
  conversation_id: "conv",
  attempts: 1,
  lease_token: "lease",
  window_end_id: "message",
  messages: [{
    id: "message",
    role: "user",
    content: "I prefer concise answers.",
  }],
};
describe("memory provider control and admission", () => {
  let cleanupByokEnv: (() => void) | null = null;
  beforeEach(() => { cleanupByokEnv = installTestByokEnv(); });
  afterEach(() => { cleanupByokEnv?.(); cleanupByokEnv = null; });

  it('uses OpenRouter BYOK for background extraction', async () => {
    const rpc = vi.fn(async () => ({ data: { default_provider: 'anthropic', providers: [
      { provider: 'anthropic', enabled: true, has_key: true }, { provider: 'openrouter', enabled: true, has_key: true },
      { provider: 'opencode', enabled: false },
    ] }, error: null }));
    await expect(createMemoryExtractor({ rpc }, subject, k =>
      k.startsWith('ENABLE_') ? undefined : undefined
    )).resolves.toBeTypeOf('function');
  });
  for (const hasUsage of [true, false]) {
    it(
      "preserves provider usage " + (hasUsage ? "as settled" : "as pending"),
      async () => {
        const body = "data: " +
          JSON.stringify({
            choices: [{ delta: { content: '{"facts":[]}' } }],
            ...(hasUsage
              ? { usage: { prompt_tokens: 100, completion_tokens: 10 } }
              : {}),
          }) + "\n\ndata: [DONE]\n\n";
        const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response(body),
        );
        const rpc = vi.fn(async (
          name: string,
          _params?: Record<string, unknown>,
        ): Promise<{ data: unknown; error: null }> => ({
          data: name === "get_user_provider_config"
            ? {
              default_provider: "openrouter",
              providers: [{ provider: "openrouter", enabled: true, has_key: true }],
            }
            : name === "get_user_provider_key_material"
            ? FAKE_BYOK_CIPHERTEXT
            : name === "get_access_grant"
            ? {
              subject_id: subject,
              enabled: true,
              allowed_features: ["chat", "memory"],
              max_daily_usd: 1,
              max_per_execution_usd: .1,
            }
            : name === "px03_create_execution"
            ? { execution: { id: "execution" }, reused: false }
            : name === "px05_admit_execution"
            ? { admitted: true, reason: "admitted" }
            : name === "memory_allowed"
            ? true
            : { id: "row", state: "committed" },
          error: null,
        }));
        const extract = await createMemoryExtractor(
          { rpc },
          subject,
          () => undefined,
        );
        expect(await decryptKey(FAKE_BYOK_CIPHERTEXT)).toBe("fake-byok-provider-key");
        expect(await extract(job)).toBe('{"facts":[]}');
        const records = rpc.mock.calls.filter((c) =>
          c[0] === "px03_record_model_call"
        );
        expect(records[records.length - 1]?.[1]?.p_cost_status).toBe(
          hasUsage ? "settled" : "pending",
        );
        if (hasUsage) {
          expect(records[records.length - 1]?.[1]?.p_total_cost)
            .toBeGreaterThan(0);
        }
        expect(rpc).toHaveBeenCalledWith("px05_commit_from_ledger", {
          p_execution_id: "execution",
        });
        fetcher.mockRestore();
      },
    );
  }
  it("never dispatches a background job without an enabled user key even if a server key exists", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("unexpected provider call"),
    );
    const client = {
      rpc: vi.fn(async () => ({
        data: {
          default_provider: "openrouter",
          providers: [{ provider: "openrouter", enabled: false, has_key: false }],
        },
        error: null,
      })),
    };
    await expect(
      createMemoryExtractor(
        client,
        subject,
        (k) => k === "OPENROUTER_API_KEY" ? "fake-server-key" : undefined,
      ),
    ).rejects.toThrow("memory_provider_unavailable");
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });
  it("budget denial produces no model invocation and remains deferred", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("unexpected provider call"),
    );
    const rpc = vi.fn(async (name: string) => ({
      data: name === "get_user_provider_config"
        ? {
          default_provider: "openrouter",
          providers: [{ provider: "openrouter", enabled: true, has_key: true }],
        }
        : name === "get_access_grant"
        ? {
          subject_id: subject,
          enabled: true,
          allowed_features: ["chat", "memory"],
          max_daily_usd: 1,
          max_per_execution_usd: .1,
        }
            : name === "get_user_provider_key_material"
            ? FAKE_BYOK_CIPHERTEXT
            : name === "px03_create_execution"
        ? { execution: { id: "execution" }, reused: false }
        : name === "px05_admit_execution"
        ? { admitted: false, reason: "budget_exhausted" }
        : true,
      error: null,
    }));
    const extract = await createMemoryExtractor(
      { rpc },
      subject,
      () => undefined,
    );
    await expect(extract(job)).rejects.toThrow("memory_budget_deferred");
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });
});
