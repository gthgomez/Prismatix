import { beforeEach, describe, expect, it } from 'vitest';
import {
  NEW_CHAT_SELECTION,
  planInitialConversation,
  readSelectedConversation,
  selectedConversationKey,
  streamUpdateAppliesToActive,
  writeSelectedConversation,
} from './conversationState';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const CONV_A = '33333333-3333-4333-8333-333333333333';
const CONV_B = '44444444-4444-4444-8444-444444444444';

beforeEach(() => localStorage.clear());

describe('per-account selected conversation', () => {
  it('namespaces the selection key by user id', () => {
    expect(selectedConversationKey(USER_A)).not.toBe(selectedConversationKey(USER_B));
    expect(selectedConversationKey(USER_A)).toContain(USER_A);
  });

  it('round-trips a selection and isolates accounts', () => {
    writeSelectedConversation(USER_A, CONV_A);
    writeSelectedConversation(USER_B, CONV_B);

    expect(readSelectedConversation(USER_A)).toBe(CONV_A);
    expect(readSelectedConversation(USER_B)).toBe(CONV_B);
  });

  it('persists a New Chat draft as the empty selection sentinel', () => {
    writeSelectedConversation(USER_A, NEW_CHAT_SELECTION);
    expect(readSelectedConversation(USER_A)).toBe(NEW_CHAT_SELECTION);
  });

  it('returns null for an account with no stored selection (account change isolated)', () => {
    writeSelectedConversation(USER_A, CONV_A);
    expect(readSelectedConversation(USER_B)).toBeNull();
  });
});

describe('initial conversation plan (account-change isolation)', () => {
  it('opens a concrete stored conversation without resetting the shared id', () => {
    expect(planInitialConversation(CONV_A)).toEqual({
      conversationId: CONV_A,
      resetGlobalConversation: false,
    });
  });

  it('resets the shared conversation id for a New Chat draft', () => {
    expect(planInitialConversation(NEW_CHAT_SELECTION)).toEqual({
      conversationId: null,
      resetGlobalConversation: true,
    });
  });

  it('resets the shared conversation id for an account with no stored selection', () => {
    // Account A selected CONV_A; account B has no per-user selection. B must
    // reset the shared id so it can never send to A's conversation.
    writeSelectedConversation(USER_A, CONV_A);
    const plan = planInitialConversation(readSelectedConversation(USER_B));
    expect(plan).toEqual({ conversationId: null, resetGlobalConversation: true });
  });
});

describe('stream update guard', () => {
  const active = {
    activeConversationId: CONV_A,
    activeClientRequestId: 'req-1',
  };

  it('applies an update only when both conversation and request id match', () => {
    expect(
      streamUpdateAppliesToActive({
        ...active,
        updateConversationId: CONV_A,
        updateClientRequestId: 'req-1',
      }),
    ).toBe(true);
  });

  it('ignores an update for a conversation the user has left', () => {
    expect(
      streamUpdateAppliesToActive({
        ...active,
        updateConversationId: CONV_B,
        updateClientRequestId: 'req-1',
      }),
    ).toBe(false);
  });

  it('ignores an update for a superseded request id', () => {
    expect(
      streamUpdateAppliesToActive({
        ...active,
        updateConversationId: CONV_A,
        updateClientRequestId: 'req-2',
      }),
    ).toBe(false);
  });

  it('ignores an update when no request is active', () => {
    expect(
      streamUpdateAppliesToActive({
        activeConversationId: null,
        activeClientRequestId: null,
        updateConversationId: CONV_A,
        updateClientRequestId: 'req-1',
      }),
    ).toBe(false);
  });
});
