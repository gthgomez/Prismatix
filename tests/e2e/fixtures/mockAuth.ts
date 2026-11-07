// tests/e2e/fixtures/mockAuth.ts
// Deterministic mock fixtures for authenticated Playwright testing without paid API calls.

import type { Page } from '@playwright/test';

export const MOCK_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'engineer@prismatix.test',
  aud: 'authenticated',
  role: 'authenticated',
  created_at: '2026-01-01T00:00:00Z',
  app_metadata: { provider: 'email' },
  user_metadata: { name: 'Lead Engineer' },
};

export const MOCK_SESSION = {
  access_token: 'mock-playwright-token-xyz',
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: 'mock-playwright-refresh',
  user: MOCK_USER,
};

export interface MockAppOptions {
  hasProviderKey?: boolean;
  conversations?: Array<{ id: string; title: string; last_activity_at: string; project_id?: string | null }>;
  messages?: Array<{ id: string; conversation_id: string; role: 'user' | 'assistant'; content: string; created_at: string }>;
  projects?: Array<{ id: string; name: string; description: string; instructions: string; archived: boolean; created_at: string }>;
  costLogs?: Array<{
    id: string;
    conversation_id: string;
    model: string;
    provider: string;
    total_cost: number;
    cost_status: string;
    created_at: string;
  }>;
}

export async function setupAuthenticatedMock(page: Page, options: MockAppOptions = {}) {
  const hasKey = options.hasProviderKey ?? true;
  const conversations = options.conversations ?? [
    {
      id: 'c1111111-1111-4111-8111-111111111111',
      title: 'Architectural Discussion',
      last_activity_at: new Date(Date.now() - 3600000).toISOString(),
      project_id: null,
    },
    {
      id: 'c2222222-2222-4222-8222-222222222222',
      title: 'Performance Benchmark Analysis',
      last_activity_at: new Date(Date.now() - 7200000).toISOString(),
      project_id: null,
    },
  ];

  const messages = options.messages ?? [
    {
      id: 'm1111111-1111-4111-8111-111111111111',
      conversation_id: 'c1111111-1111-4111-8111-111111111111',
      role: 'user',
      content: 'Explain the difference between Paxos and Raft.',
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: 'm2222222-2222-4222-8222-222222222222',
      conversation_id: 'c1111111-1111-4111-8111-111111111111',
      role: 'assistant',
      content: 'Paxos and Raft both solve distributed consensus under partial network partitions...',
      created_at: new Date(Date.now() - 3590000).toISOString(),
    },
  ];

  const projects = options.projects ?? [];
  const costLogs = options.costLogs ?? [
    {
      id: 'cost-1',
      conversation_id: 'c1111111-1111-4111-8111-111111111111',
      model: 'gemini-3.8-flash',
      provider: 'google',
      total_cost: 0.00045,
      cost_status: 'settled',
      created_at: new Date().toISOString(),
    },
  ];

  // Inject session into all common Supabase storage keys before page scripts run
  await page.addInitScript((sessionData) => {
    const raw = JSON.stringify(sessionData);
    window.localStorage.setItem('sb-mock-auth-token', raw);
    window.localStorage.setItem('supabase.auth.token', raw);
    window.localStorage.setItem('sb-test-prismatix-auth-token', raw);
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        window.localStorage.setItem(key, raw);
      }
    }
  }, MOCK_SESSION);

  // Mock Supabase Auth API
  await page.route('**/auth/v1/user*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USER),
    });
  });

  await page.route('**/auth/v1/session*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SESSION),
    });
  });

  await page.route('**/auth/v1/token*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SESSION),
    });
  });

  // Mock Provider Settings Edge Function
  await page.route('**/functions/v1/provider-settings*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const postData = req.postDataJSON() as Record<string, unknown> | null;
      if (postData?.action === 'set_key' || postData?.action === 'set_enabled') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            providers: [
              {
                id: 'openrouter',
                label: 'OpenRouter',
                enabled: true,
                hasKey: true,
                keyLast4: '9999',
                offeredByDefault: true,
                defaultProvider: true,
                status: 'enabled',
              },
            ],
            defaultProvider: 'openrouter',
          }),
        });
      }
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        providers: [
          {
            id: 'openrouter',
            label: 'OpenRouter',
            enabled: hasKey,
            hasKey: hasKey,
            keyLast4: hasKey ? '1234' : null,
            offeredByDefault: true,
            defaultProvider: true,
            status: hasKey ? 'enabled' : 'not_configured',
          },
        ],
        defaultProvider: 'openrouter',
      }),
    });
  });

  // Mock Conversations REST API
  await page.route('**/rest/v1/conversations*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown> | null;
      const created = {
        id: String(body?.id || `c-${Date.now()}`),
        title: String(body?.title || 'New Chat'),
        last_activity_at: new Date().toISOString(),
        project_id: body?.project_id ? String(body.project_id) : null,
      };
      conversations.unshift(created);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify([created]),
      });
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(conversations),
    });
  });

  // Mock Messages REST API
  await page.route('**/rest/v1/messages*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify([{ id: `msg-${Date.now()}`, created_at: new Date().toISOString() }]),
      });
    }

    const url = new URL(req.url());
    const convId = url.searchParams.get('conversation_id');
    const filtered = convId
      ? messages.filter((m) => m.conversation_id === convId.replace(/^eq\./, ''))
      : messages;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(filtered),
    });
  });

  // Mock Projects REST API
  await page.route('**/rest/v1/projects*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(projects),
    });
  });

  // Mock Cost Logs REST API
  await page.route('**/rest/v1/cost_logs*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(costLogs),
    });
  });

  // Mock Spend Stats Edge Function
  await page.route('**/functions/v1/spend_stats*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ today: 0 }),
    });
  });

  // Mock Prompt Templates REST API (Wave 2)
  await page.route('**/rest/v1/prompt_templates*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'mock-pt-1',
          user_id: MOCK_USER.id,
          title: 'Code Reviewer',
          description: 'Comprehensive code review',
          template: 'Review the following code for security and performance:\n\n{{code}}',
          variables: ['code'],
          category: 'coding',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]),
    });
  });

  // Mock User Preferences REST API (Wave 2)
  await page.route('**/rest/v1/user_preferences*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user_id: MOCK_USER.id,
        preferences: {
          routingProfile: 'balanced',
          theme: 'dark',
          webSearchEnabled: false,
        },
        updated_at: new Date().toISOString(),
      }),
    });
  });

  // Mock Router SSE streaming endpoint
  await page.route('**/functions/v1/router*', async (route) => {
    const postData = route.request().postData() || '';
    const hasCodeRequest = postData.includes('typescript') || postData.includes('function') || postData.includes('code');
    const responseText = hasCodeRequest
      ? 'Here is your TypeScript function:\n\n```typescript:calculateSum.ts\nexport function calculateSum(a: number, b: number): number {\n  return a + b;\n}\n```\n'
      : 'Hello from verified Prismatix test environment!';

    const sseResponse = [
      'event: message\n',
      'data: {"type":"meta","model":"gemini-3.8-flash","cost":{"finalUsd":0.00032}}\n\n',
      'event: message\n',
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: responseText } })}\n\n`,
      'event: message\n',
      'data: [DONE]\n\n',
    ].join('');

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: sseResponse,
    });
  });

  // Mock Image Generation Edge Function
  await page.route('**/functions/v1/image-generation*', async (route) => {
    const postData = (route.request().postDataJSON() || {}) as Record<string, unknown>;
    const prompt = (postData.prompt as string) || 'generated image';
    const modelId = (postData.modelId as string) || 'flux-1-schnell';
    const isMock = Boolean(postData.mockMode);
    const svgData = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#4ECDC4"/><text x="256" y="256" fill="#fff" text-anchor="middle">${prompt}</text></svg>`;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        imageUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svgData)}`,
        modelId,
        prompt,
        size: '1024x1024',
        costUsd: isMock ? 0 : 0.003,
        costStatus: isMock ? 'unmetered' : 'settled',
        isMock,
        executionId: 'mock-exec-id-1234',
        timestamp: new Date().toISOString(),
      }),
    });
  });
}

export async function signInAsMockUser(page: Page) {
  await page.goto('/');
  // Wait for React lazy suspense to load the auth form
  const emailInput = page.locator('#email');
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  await emailInput.fill(MOCK_USER.email);
  await page.locator('#password').fill('ValidPassword123!');
  await page.locator('button[type="submit"]').click();
}

