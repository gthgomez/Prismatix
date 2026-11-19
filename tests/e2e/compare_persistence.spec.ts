import { expect, test } from '@playwright/test';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

const executions = [
  '00000000-0000-4000-8000-000000000801',
  '00000000-0000-4000-8000-000000000802',
];
const assistantIds = [
  '00000000-0000-4000-8000-000000000811',
  '00000000-0000-4000-8000-000000000812',
];

test('enabled Compare reloads both responses and never writes a message', async ({ page }) => {
  test.skip(process.env.VITE_PX08_COMPARE_DURABILITY !== 'true', 'Requires the opt-in synthetic Compare build');
  await setupAuthenticatedMock(page, { conversations: [], messages: [] });
  const requests: Array<Record<string, unknown>> = [];
  const assistantRows: Array<Record<string, unknown>> = [];
  const browserWrites: string[] = [];
  let savedGroup: Record<string, unknown> | undefined;
  const prompt = 'Compare the synthetic answers.';
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/messages') && request.method() !== 'GET') {
      browserWrites.push(request.method());
    }
  });
  await page.route('**/functions/v1/router', async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    const index = requests.push(request) - 1;
    const model = request.modelOverride;
    const content = `Persisted Compare response ${index + 1}`;
    const executionId = executions[index];
    assistantRows.push({
      id: assistantIds[index],
      execution_id: executionId,
      role: 'assistant',
      content,
      model_used: model,
      conversation_id: request.conversationId,
      created_at: new Date(Date.now() + index).toISOString(),
    });
    const events = [
      { type: 'meta', model },
      { type: 'content_block_delta', delta: { text: content } },
      { type: 'receipt', executionId, status: 'completed', transcript: { saved: true }, settlement: { state: 'settled', committedUsd: 0.001, pendingCalls: 0 }, calls: [] },
    ];
    await route.fulfill({
      headers: { 'Content-Type': 'text/event-stream', 'X-Prismatix-Execution-Id': executionId! },
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
    });
  });
  await page.route('**/rest/v1/rpc/px08_persist_compare', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['p_conversation_id', 'p_execution_a', 'p_execution_b']);
    expect(new Set([body.p_execution_a, body.p_execution_b])).toEqual(new Set(executions));
    const conversationId = body.p_conversation_id;
    expect(requests.map((request) => request.conversationId)).toEqual([conversationId, conversationId]);
    expect(requests[0]?.comparisonGroupId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(requests[0]?.comparisonGroupId).toBe(requests[1]?.comparisonGroupId);
    const child = (id: unknown) => {
      const row = assistantRows.find((entry) => entry.execution_id === id)!;
      return {
        executionId: row.execution_id, assistantMessageId: row.id,
        model: row.model_used, content: row.content, status: 'completed',
        cost: 0.001, costStatus: 'settled', transcriptSaved: true,
      };
    };
    savedGroup = {
      id: '00000000-0000-4000-8000-000000000820', conversationId,
      modelA: child(body.p_execution_a), modelB: child(body.p_execution_b),
    };
    await route.fulfill({ json: savedGroup });
  });
  await page.route('**/rest/v1/rpc/px08_get_compare_groups', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body.p_conversation_id).toBe(savedGroup?.conversationId);
    expect(new Set(body.p_execution_ids as string[])).toEqual(new Set(executions));
    await route.fulfill({ json: savedGroup ? [savedGroup] : [] });
  });
  await page.route('**/rest/v1/messages?*', async (route) => {
    await route.fulfill({ json: [...assistantRows].reverse() });
  });
  await page.route('**/rest/v1/conversations?*', async (route) => {
    if (!savedGroup) return route.fallback();
    const row = { id: savedGroup.conversationId, title: prompt, last_activity_at: new Date().toISOString(), project_id: null };
    const requestsObject = route.request().headers().accept?.includes('object+json');
    await route.fulfill({ json: requestsObject ? row : [row] });
  });

  await signInAsMockUser(page);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill(prompt);
  await composer.press('Enter');
  await expect.poll(() => requests.length).toBe(2);
  await expect.poll(() => savedGroup?.id).toBeTruthy();
  await expect(page.getByText('Persisted Compare response 1', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Persisted Compare response 2', { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByText('Persisted Compare response 1', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Persisted Compare response 2', { exact: true })).toHaveCount(1);
  expect(requests).toHaveLength(2);
  expect(browserWrites).toEqual([]);
});
