import { describe, expect, it, vi } from "vitest";
import { handleMemoryRequest } from "../../supabase/functions/memory/index";

const subject = "11111111-1111-4111-8111-111111111111";
function fixture(user: string | null = subject) {
  const rpc = vi.fn(async (
    name: string,
    _params?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }> => ({
    data: name === "get_access_grant"
      ? {
        subject_id: subject,
        enabled: true,
        role: "user",
        allowed_features: ["chat", "memory"],
      }
      : name === "memory_search"
      ? []
      : { enabled: true, entitled: true, count: 0, jobs: [] },
    error: null,
  }));
  return {
    rpc,
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: user ? { id: user } : null },
        error: null,
      })),
    },
  };
}
const env = (
  key: string,
) => ({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-server-key",
  ALLOWED_ORIGIN: "https://app.example",
}[key]);
const request = (body: unknown, auth = true) =>
  new Request("https://example/memory", {
    method: "POST",
    headers: auth ? { Authorization: "Bearer fake-user-token" } : {},
    body: JSON.stringify(body),
  });
describe("authenticated memory controls", () => {
  it("rejects unauthenticated calls before any storage access", async () => {
    const client = fixture(null);
    const res = await handleMemoryRequest(
      request({ action: "status" }, false),
      {
        getEnv: env,
        createClient: () => client,
      },
    );
    expect(res.status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("binds search to validated identity and rejects supplied account selectors", async () => {
    const client = fixture();
    const deps = { getEnv: env, createClient: () => client };
    const res = await handleMemoryRequest(
      request({ action: "search_memory", query: "café" }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("memory_search", {
      p_subject_id: subject,
      p_query: "café",
      p_limit: 8,
    });
    expect(
      (await handleMemoryRequest(
        request({ action: "search_memory", query: "x", user_id: "other" }),
        deps,
      )).status,
    ).toBe(400);
  });
  it("validates corrections and never accepts worker RPCs through the public endpoint", async () => {
    const client = fixture();
    const deps = { getEnv: env, createClient: () => client };
    expect(
      (await handleMemoryRequest(
        request({ action: "correct", id: "bad", text: "valid text" }),
        deps,
      )).status,
    ).toBe(400);
    expect(
      (await handleMemoryRequest(
        request({ action: "memory_complete", facts: [] }),
        deps,
      )).status,
    ).toBe(400);
    expect(
      (await handleMemoryRequest(
        request({ action: "remember", text: "x".repeat(501) }),
        deps,
      ))
        .status,
    ).toBe(400);
  });
  it("uses owner-bound UUID pagination and rejects date cursors", async () => {
    const client = fixture();
    const deps = { getEnv: env, createClient: () => client };
    expect(
      (await handleMemoryRequest(
        request({ action: "list", before: subject }),
        deps,
      )).status,
    ).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("memory_list", {
      p_subject_id: subject,
      p_before: subject,
    });
    expect(
      (await handleMemoryRequest(
        request({ action: "list", before: "2026-10-10" }),
        deps,
      )).status,
    ).toBe(400);
  });
  it("returns a storage failure instead of claiming a successful save", async () => {
    const client = fixture();
    client.rpc.mockImplementation(async (name) =>
      name === "get_access_grant"
        ? {
          data: {
            subject_id: subject,
            enabled: true,
            allowed_features: ["chat", "memory"],
          },
          error: null,
        }
        : { data: null, error: { message: "failed" } } as never
    );
    expect(
      (await handleMemoryRequest(
        request({ action: "remember", text: "I like short answers." }),
        {
          getEnv: env,
          createClient: () => client,
        },
      )).status,
    ).toBe(503);
  });
});
