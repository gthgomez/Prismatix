import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { FirstRunSetupCard } from './FirstRunSetupCard';
import type { ProviderPlugins } from '../hooks/useProviderPlugins';

function renderCard(validateKey: ProviderPlugins['validateKey']) {
  const container = document.createElement('div');
  document.body.append(container);
  const root: Root = createRoot(container);
  const plugins = {
    validateKey,
    setKey: vi.fn().mockResolvedValue(true),
  } as unknown as ProviderPlugins;
  const onSaved = vi.fn();
  act(() => root.render(<FirstRunSetupCard plugins={plugins} onOpenSettings={() => {}} onSaved={onSaved} />));
  return { container, root, plugins, onSaved };
}

describe('FirstRunSetupCard connection status', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('reports a saved key as verified only after an enabled validation result', async () => {
    const validateKey = vi.fn().mockResolvedValue({ provider: 'openrouter', status: 'enabled' });
    const { container, root, plugins, onSaved } = renderCard(validateKey as ProviderPlugins['validateKey']);
    const input = container.querySelector<HTMLInputElement>('#first-run-openrouter-key')!;
    const form = container.querySelector('form')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'sk-or-test-key');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(validateKey).toHaveBeenCalledWith('openrouter', 'sk-or-test-key');
    expect(plugins.setKey).toHaveBeenCalledWith('openrouter', 'sk-or-test-key', { provider: 'openrouter', status: 'enabled' });
    expect(container.textContent).toContain('Key saved and verified');
    expect(container.querySelector('.first-run-status')?.classList.contains('success')).toBe(true);
    expect(onSaved).toHaveBeenCalledWith('Key saved and verified. You are ready to chat.', true);
    await act(async () => root.unmount());
  });

  it('saves after unavailable validation but labels the result unverified', async () => {
    const validateKey = vi.fn().mockResolvedValue({ provider: 'openrouter', status: 'unavailable' });
    const { container, root, plugins, onSaved } = renderCard(validateKey as ProviderPlugins['validateKey']);
    const input = container.querySelector<HTMLInputElement>('#first-run-openrouter-key')!;
    const form = container.querySelector('form')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'sk-or-test-key');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(plugins.setKey).toHaveBeenCalledWith('openrouter', 'sk-or-test-key', { provider: 'openrouter', status: 'unavailable' });
    expect(container.textContent).toContain('could not be verified');
    expect(container.textContent).toContain('Chat is paused until you verify this key or update it in Provider Settings.');
    expect(container.textContent).not.toContain('You can try it now');
    expect(container.querySelector('.first-run-status')?.classList.contains('pending')).toBe(true);
    expect(container.textContent).not.toContain('You are ready to chat.');
    expect(onSaved).toHaveBeenCalledWith(expect.stringContaining('could not be verified'), false);
    await act(async () => root.unmount());
  });

  it('keeps a rejected key unsaved and allows a corrected key to verify', async () => {
    const validateKey = vi.fn()
      .mockResolvedValueOnce({ provider: 'openrouter', status: 'invalid_revoked' })
      .mockResolvedValueOnce({ provider: 'openrouter', status: 'enabled' });
    const { container, root, plugins } = renderCard(validateKey as ProviderPlugins['validateKey']);
    const input = container.querySelector<HTMLInputElement>('#first-run-openrouter-key')!;
    const form = container.querySelector('form')!;
    const submit = async (value: string) => act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await submit('sk-or-rejected');
    expect(container.textContent).toContain('Key rejected');
    expect(plugins.setKey).not.toHaveBeenCalled();
    await submit('sk-or-corrected');
    expect(plugins.setKey).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Key saved and verified');
    await act(async () => root.unmount());
  });

  it('does not save a key when its deferred check belongs to a previous account', async () => {
    const validateKey = vi.fn().mockResolvedValue({
      provider: 'openrouter',
      status: 'unavailable',
      stale: true,
    });
    const { container, root, plugins, onSaved } = renderCard(validateKey as ProviderPlugins['validateKey']);
    const input = container.querySelector<HTMLInputElement>('#first-run-openrouter-key')!;
    const form = container.querySelector('form')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'sk-or-stale-account-key');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(plugins.setKey).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(container.textContent).toContain('The key was not saved');
    await act(async () => root.unmount());
  });
});
