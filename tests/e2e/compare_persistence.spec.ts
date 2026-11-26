import { expect, test } from '@playwright/test';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';
import { servingRouteFixture } from '../helpers/serving-route-fixtures.ts';

const executions = [
  '00000000-0000-4000-8000-000000000801',
  '00000000-0000-4000-8000-000000000802',
];
const assistantIds = [
  '00000000-0000-4000-8000-000000000811',
  '00000000-0000-4000-8000-000000000812',
];

test('enabled Compare reloads both responses and leaves message persistence to the server', async ({ page }) => {
  test.skip(process.env.VITE_PX08_COMPARE_DURABILITY !== 'true', 'Requires the opt-in synthetic Compare build');
  const routeA = servingRouteFixture('openrouter', 'google/gemini-3.8-flash');
  const routeB = servingRouteFixture('openrouter', 'openai/gpt-6.2-sol');
  await setupAuthenticatedMock(page, { conversations: [], messages: [], routes: [routeA, routeB] });
  const requests: Array<Record<string, unknown>> = [];
  const assistantRows: Array<Record<string, unknown>> = [];
  const browserWrites: string[] = [];
  let savedGroup: Record<string, unknown> | undefined;
  let rejectPreference = true;
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
      { type: 'receipt', executionId, status: 'completed', transcript: { saved: true }, settlement: { state: 'settled', committedUsd: 0.001, pendingCalls: 0 }, calls: [{ stage: 'baseline', participant: 'openrouter', attemptNumber: 1, servedModel: String(model), costStatus: 'settled', totalCost: 0.001 }] },
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
  await page.route('**/rest/v1/rpc/px08_set_compare_preference', async (route) => {
    const { p_compare_group_id: groupId, p_preferred_side: preferredSide } = route.request().postDataJSON();
    expect(groupId).toBe(savedGroup?.id);
    if (rejectPreference) {
      await route.fulfill({ status: 503, json: { message: 'Synthetic preference outage' } });
      return;
    }
    savedGroup!.preferredSide = preferredSide;
    await route.fulfill({ json: { id: groupId, preferredSide } });
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
  const toggle = page.getByRole('button', { name: 'Routing details', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  const routingPanel = page.getByRole('complementary', { name: 'Routing details' });
  await routingPanel.getByText('Model options', { exact: true }).click();
  await routingPanel.getByLabel('Model A').selectOption(routeA.id);
  await routingPanel.getByLabel('Model B').selectOption(routeB.id);
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill(prompt);
  await composer.press('Enter');
  await expect.poll(() => requests.length).toBe(2);
  await expect.poll(() => savedGroup?.id).toBeTruthy();
  await expect(page.getByText('Persisted Compare response 1', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Persisted Compare response 2', { exact: true })).toHaveCount(1);
  const firstPreference = page.locator('.comparison-column.model-a').getByRole('button', { name: 'Prefer this model' });
  await firstPreference.click();
  await expect(page.getByText('The comparison preference could not be saved. Try again.')).toBeVisible();
  await expect(firstPreference).toHaveAttribute('aria-pressed', 'false');
  rejectPreference = false;
  const secondPreference = page.locator('.comparison-column.model-b').getByRole('button', { name: /Prefer.* model/ });
  await secondPreference.click();
  await expect(secondPreference).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByText('Persisted Compare response 1', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Persisted Compare response 2', { exact: true })).toHaveCount(1);
  await expect(secondPreference).toHaveAttribute('aria-pressed', 'true');
  expect(requests).toHaveLength(2);
  expect(browserWrites).toEqual([]);
});

test('history restores a failed Compare card after its unchanged saved prompt', async ({ page }) => {
  test.skip(process.env.VITE_PX08_COMPARE_DURABILITY !== 'true', 'Requires the opt-in synthetic Compare build');
  const conversationId = '00000000-0000-4000-8000-000000000830';
  const prompt = 'A saved prompt with no saved answers';
  await setupAuthenticatedMock(page, { conversations: [
    { id: conversationId, title: 'Failed comparison', last_activity_at: '2026-11-19T00:00:00Z', project_id: null },
  ], messages: executions.map((id, index) => ({
    id: assistantIds[index]!, role: 'user', content: prompt, conversation_id: conversationId,
    execution_id: id, created_at: `2026-11-19T00:00:0${index}Z`,
  })) });
  await page.route('**/rest/v1/rpc/px08_get_compare_groups', async (route) => {
    const request = route.request().postDataJSON();
    expect(request.p_conversation_id).toBe(conversationId);
    expect(new Set(request.p_execution_ids)).toEqual(new Set(executions));
    await route.fulfill({ json: [{
      id: '00000000-0000-4000-8000-000000000831', conversationId,
      modelA: { executionId: executions[0], model: 'gemini-3.8-flash', content: '', status: 'failed', costStatus: 'unknown', transcriptSaved: false },
      modelB: { executionId: executions[1], model: 'gpt-6-sol', content: '', status: 'failed', costStatus: 'unknown', transcriptSaved: false },
    }] });
  });
  await signInAsMockUser(page);
  await page.getByText('Failed comparison', { exact: true }).click();
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
  await expect(page.locator('.comparison-column').getByText('Failed', { exact: true })).toHaveCount(2);
  await page.reload();
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
  await expect(page.locator('.comparison-column').getByText('Failed', { exact: true })).toHaveCount(2);
  await expect(page.locator('.comparison-column').getByRole('button', { name: 'Prefer this model' }).first()).toBeDisabled();
});
