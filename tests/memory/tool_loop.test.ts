import { describe, expect, it, vi } from "vitest";
import { dispatchMemoryToolStream } from "../../supabase/functions/router/memory_tools";
import { createExecutionOutputBudget } from "../../supabase/functions/router/admission";
const owner = "11111111-1111-4111-8111-111111111111";
const item = "22222222-2222-4222-8222-222222222222";
function sse(payloads: unknown[]) {
  return new Response(
    payloads.map((p) => "data: " + JSON.stringify(p) + "\n\n").join("") +
      "data: [DONE]\n\n",
  );
}
function deps() {
  const rpc = vi.fn(async (
    name: string,
    _params?: Record<string, unknown>,
  ) => ({
    data: name === "memory_search"
      ? [{
        id: item,
        text: "I prefer concise answers.",
        kind: "preference",
        basis: "user_statement",
        sources: [],
      }]
      : { id: "row" },
    error: null,
  }));
  return {
    rpc,
    meter: {
      store: { rpc },
      execution: { id: "exec", conversation_id: "conv" } as never,
      stage: "baseline",
      participant: "openrouter",
      attemptNumber: 1,
      requestedModel: "test-model",
      priceSnapshot: { inputRatePer1M: 1, outputRatePer1M: 2 },
      outputBudget: createExecutionOutputBudget(.1),
    },
  };
}
const args = (f: ReturnType<typeof deps>) => ({
  gateway: "openrouter" as const,
  model: "test/model",
  baseUrl: "https://provider.example",
  apiKey: "fake-key",
  messages: [{ role: "user", content: "What are my preferences?" }],
  maxTokens: 768,
  signal: new AbortController().signal,
  meter: f.meter,
  client: { rpc: f.rpc },
  subject: owner,
});
describe("bounded streaming memory tools", () => {
  it("collects fragmented tool arguments, binds the owner, and streams only answer text", async () => {
    const f = deps();
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sse([{
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call-1",
                function: { name: "search_memory", arguments: '{"query":' },
              }],
            },
          }],
        }, {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '"preferences"}' },
              }],
            },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }]),
      )
      .mockResolvedValueOnce(
        sse([{
          choices: [{ delta: { content: "I remember concise answers." } }],
          usage: { prompt_tokens: 150, completion_tokens: 20 },
        }]),
      );
    const result = await dispatchMemoryToolStream(args(f));
    const wire = await result.response.text();
    expect(wire).toContain("I remember concise answers.");
    expect(wire).not.toContain("tool_calls");
    expect(wire).not.toContain("search_memory");
    expect(f.rpc).toHaveBeenCalledWith("memory_search", {
      p_subject_id: owner,
      p_query: "preferences",
      p_limit: 8,
    });
    expect(await result.usagePromise).toEqual({
      inputTokens: 250,
      outputTokens: 30,
      thinkingTokens: 0,
    });
    expect(
      f.rpc.mock.calls.filter((c) =>
        c[0] === "px03_record_model_call" && c[1]?.p_cost_status === "settled"
      ),
    ).toHaveLength(2);
    const second = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(
      second.messages.some((m: any) =>
        m.role === "tool" && m.content.includes(item)
      ),
    ).toBe(
      true,
    );
    fetcher.mockRestore();
  });
  it("executes at most two requested tools and then forces a final answer", async () => {
    const f = deps();
    const calls = Array.from(
      { length: 3 },
      (_, index) => ({
        index,
        id: "call-" + index,
        function: {
          name: "search_memory",
          arguments: '{"query":"preferences"}',
        },
      }),
    );
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      sse([{ choices: [{ delta: { tool_calls: calls } }] }]),
    ).mockResolvedValueOnce(
      sse([{ choices: [{ delta: { content: "Done" } }] }]),
    );
    const result = await dispatchMemoryToolStream(args(f));
    await result.response.text();
    expect(f.rpc.mock.calls.filter((c) => c[0] === "memory_search"))
      .toHaveLength(2);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).tool_choice)
      .toBe("none");
    fetcher.mockRestore();
  });
  it("rejects account arguments without executing a database tool", async () => {
    const f = deps();
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      sse([{
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "call-1",
              function: {
                name: "search_memory",
                arguments: '{"query":"preferences","user_id":"other"}',
              },
            }],
          },
        }],
      }]),
    ).mockResolvedValueOnce(
      sse([{ choices: [{ delta: { content: "No valid evidence." } }] }]),
    );
    const result = await dispatchMemoryToolStream(args(f));
    await result.response.text();
    expect(f.rpc.mock.calls.some((c) => c[0] === "memory_search")).toBe(false);
    fetcher.mockRestore();
  });
  it("does not turn upstream HTTP failure into a successful answer", async () => {
    const f = deps();
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("failure", { status: 400 }),
    );
    await expect(dispatchMemoryToolStream(args(f))).rejects.toThrow(
      "memory_tool_upstream_failed",
    );
    expect(f.rpc.mock.calls.some((c) => c[1]?.p_status === "completed")).toBe(
      false,
    );
    fetcher.mockRestore();
  });
});
