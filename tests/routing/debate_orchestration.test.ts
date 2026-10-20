import { describe, expect, it } from 'vitest';
import {
  parseDebateRequest,
  computeDebateEligibility,
  buildDebateHeaders,
} from '../../supabase/functions/router/debate_runtime.ts';
import {
  getDebatePlan,
} from '../../supabase/functions/router/debate_profiles.ts';
import {
  getModelBenchmark,
  getModelIntelligenceBand,
  resolvePeerChallengers,
} from '../../supabase/functions/_shared/model_benchmarks.ts';
import { buildChallengerPrompt, buildSynthesisPrompt } from '../../supabase/functions/router/debate_prompts.ts';
import { createExecutionOutputBudget } from '../../supabase/functions/router/admission.ts';
import { createNormalizedProxyStream } from '../../supabase/functions/router/sse_normalizer.ts';

describe('Debate Mode Orchestration & End-to-End Safety', () => {
  describe('Debate Request Parsing & Deterministic Mode Selection', () => {
    it('detects explicit opt-out via mode="off", override="off", or profile="off"', () => {
      const modeOff = parseDebateRequest('off');
      expect(modeOff.optOut).toBe(true);
      expect(modeOff.requested).toBe(false);
      expect(modeOff.trigger).toBe('off');

      const overrideOff = parseDebateRequest(undefined, 'off');
      expect(overrideOff.optOut).toBe(true);
      expect(overrideOff.requested).toBe(false);

      const debateOffTag = parseDebateRequest(undefined, 'debate:off');
      expect(debateOffTag.optOut).toBe(true);
      expect(debateOffTag.suppressModelOverride).toBe(true);

      const profileOff = parseDebateRequest(undefined, undefined, 'off');
      expect(profileOff.optOut).toBe(true);
    });

    it('detects explicit debate requests across supported contracts', () => {
      const modeDebate = parseDebateRequest('debate', undefined, 'code');
      expect(modeDebate.requested).toBe(true);
      expect(modeDebate.optOut).toBe(false);
      expect(modeDebate.profile).toBe('code');
      expect(modeDebate.trigger).toBe('explicit');

      const overrideDebate = parseDebateRequest(undefined, 'debate:video_ui');
      expect(overrideDebate.requested).toBe(true);
      expect(overrideDebate.profile).toBe('video_ui');
      expect(overrideDebate.suppressModelOverride).toBe(true);
    });
  });

  describe('Debate Eligibility & Opt-Out Authority', () => {
    it('strictly enforces explicit debate opt-out even if complexity score is high and auto-debate is enabled', () => {
      const eligibility = computeDebateEligibility({
        profile: 'general',
        enableDebateMode: true,
        enableDebateAuto: true,
        debateRequested: false,
        debateOptOut: true,
        hasImages: false,
        hasVideoAssets: false,
        complexityScore: 99,
        threshold: 75,
      });

      expect(eligibility.doDebate).toBe(false);
      expect(eligibility.trigger).toBe('off');
    });

    it('enables debate automatically when eligible and complexity exceeds threshold', () => {
      const eligibility = computeDebateEligibility({
        profile: 'general',
        enableDebateMode: true,
        enableDebateAuto: true,
        debateRequested: false,
        debateOptOut: false,
        hasImages: false,
        hasVideoAssets: false,
        complexityScore: 88,
        threshold: 75,
      });

      expect(eligibility.doDebate).toBe(true);
      expect(eligibility.trigger).toBe('auto');
    });

    it('bypasses debate when mixed images are present on non-video profile', () => {
      const eligibility = computeDebateEligibility({
        profile: 'general',
        enableDebateMode: true,
        enableDebateAuto: true,
        debateRequested: true,
        debateOptOut: false,
        hasImages: true,
        hasVideoAssets: false,
        complexityScore: 95,
        threshold: 75,
      });

      expect(eligibility.doDebate).toBe(false);
    });
  });

  describe('Adversarial 3-Stage Prompting Workflow', () => {
    it('includes proposer draft in challenger prompt for direct critical review', () => {
      const userQuery = 'How should we implement atomic ledger commits?';
      const proposerDraft = 'Draft: Just run UPDATE px05_budget_reservations without checks.';
      const challengerPrompt = buildChallengerPrompt('code', 'critic', userQuery, proposerDraft);

      expect(challengerPrompt).toContain('PROPOSED SOLUTION TO CRITIQUE:');
      expect(challengerPrompt).toContain(proposerDraft);
      expect(challengerPrompt).toContain('Role: Code Correctness & Security Reviewer');
      expect(challengerPrompt).toContain('concrete failure scenarios');
    });

    it('provides distinct production and error recovery instructions for code implementer', () => {
      const userQuery = 'How should we implement atomic ledger commits?';
      const proposerDraft = 'Draft: Just run UPDATE px05_budget_reservations without checks.';
      const implementerPrompt = buildChallengerPrompt('code', 'implementer', userQuery, proposerDraft);

      expect(implementerPrompt).toContain('Role: Code Production & Implementation Specialist');
      expect(implementerPrompt).toContain('production viability');
      expect(implementerPrompt).toContain('error handling and failure recovery');
    });

    it('supplies both proposer draft and challenger critique to synthesizer for adjudication', () => {
      const userQuery = 'How should we implement atomic ledger commits?';
      const proposerDraft = 'Draft proposal: single UPDATE statement.';
      const challengers = [
        {
          role: 'critic',
          modelTier: 'deepseek-v4-1-flash',
          text: 'Vulnerability: lacks row-level locking and race condition guard.',
        },
      ];

      const synthesisPrompt = buildSynthesisPrompt(
        'code',
        userQuery,
        challengers,
        2000,
        proposerDraft,
      );

      expect(synthesisPrompt).toContain('INITIAL PROPOSAL:');
      expect(synthesisPrompt).toContain(proposerDraft);
      expect(synthesisPrompt).toContain('REVIEW NOTES:');
      expect(synthesisPrompt).toContain('Vulnerability: lacks row-level locking');
      expect(synthesisPrompt).toContain('ACCEPT valid bugs');
      expect(synthesisPrompt).toContain('REJECT invalid');
    });
  });

  describe('Budget Clamping & Zero Allowance Protection', () => {
    it('refuses to convert 0 remaining budget into a 1-token allowance', () => {
      const budget = createExecutionOutputBudget(0.01); // $0.01 max
      // Rate: $2.00 per 1M output tokens => 5,000 tokens per $0.01
      const firstGranted = budget.clampTokenCap(5000, 2.0);
      expect(firstGranted).toBe(5000);
      expect(budget.remainingUsd()).toBe(0);

      // Subsequent stage requested when remaining USD is 0:
      const secondGranted = budget.clampTokenCap(1000, 2.0);
      expect(secondGranted).toBe(0); // Must be strictly 0, never converted to 1
    });
  });

  describe('Debate Headers & SSE Metadata Delivery', () => {
    it('emits costNote: full when debate headers are built for multi-stage execution', () => {
      const headers = buildDebateHeaders({
        debateActive: true,
        debateProfile: 'code',
        debateTrigger: 'explicit',
        debateModelTier: 'deepseek-v4-pro',
        costNote: 'full',
      });

      expect(headers['X-Debate-Mode']).toBe('true');
      expect(headers['X-Debate-Profile']).toBe('code');
      expect(headers['X-Debate-Trigger']).toBe('explicit');
      expect(headers['X-Debate-Cost-Note']).toBe('full');
    });

    it('emits debate participants in initial SSE meta event', async () => {
      const upstreamChunks = [
        'data: {"choices":[{"delta":{"content":"Final "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Answer"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      const encoder = new TextEncoder();
      const upstreamBody = new ReadableStream({
        start(controller) {
          for (const chunk of upstreamChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      const participants = [
        {
          role: 'proposer',
          model: 'deepseek-v4-pro',
          response: 'Initial draft',
        },
        {
          role: 'critic',
          model: 'deepseek-v4-1-flash',
          response: 'Critical feedback',
        },
      ];

      const proxyStream = createNormalizedProxyStream({
        upstreamBody,
        initialMeta: { debate_participants: participants },
        extractDeltas: (payload: unknown) => {
          const p = payload as { choices?: Array<{ delta?: { content?: string } }> } | null;
          return [p?.choices?.[0]?.delta?.content || ''];
        },
        onDelta: () => {},
        onComplete: async () => ({}),
      });

      const reader = proxyStream.getReader();
      const decoder = new TextDecoder();
      let fullOutput = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        fullOutput += decoder.decode(value);
      }

      // Must emit meta event containing debate_participants at stream beginning
      expect(fullOutput).toContain('data: {"type":"meta","debate_participants":');
      expect(fullOutput).toContain('"role":"proposer"');
      expect(fullOutput).toContain('"role":"critic"');
      expect(fullOutput).toContain('"role":"critic"');
      // Followed by standard text deltas
      expect(fullOutput).toContain('Final ');
      expect(fullOutput).toContain('Answer');
    });

    it('emits X-Debate-Execution-Mode header for auto and manual debate modes', () => {
      const autoHeaders = buildDebateHeaders({
        debateActive: true,
        debateProfile: 'general',
        debateTrigger: 'explicit',
        debateExecutionMode: 'auto',
      });
      expect(autoHeaders['X-Debate-Execution-Mode']).toBe('auto');

      const manualHeaders = buildDebateHeaders({
        debateActive: true,
        debateProfile: 'code',
        debateTrigger: 'explicit',
        debateExecutionMode: 'manual',
      });
      expect(manualHeaders['X-Debate-Execution-Mode']).toBe('manual');
    });
  });

  describe('Benchmark Intelligence Ranking & Peer Challenger Pairing', () => {
    it('correctly categorizes models into standardized intelligence bands', () => {
      expect(getModelIntelligenceBand('claude-opus-5-5')).toBe('frontier');
      expect(getModelIntelligenceBand('gpt-6.1-sol')).toBe('frontier');
      expect(getModelIntelligenceBand('claude-sonnet-5-5')).toBe('high');
      expect(getModelIntelligenceBand('deepseek-v4-pro')).toBe('high');
      expect(getModelIntelligenceBand('deepseek-v4-1-flash')).toBe('balanced');
      expect(getModelIntelligenceBand('gpt-6-luna')).toBe('balanced');
      expect(getModelIntelligenceBand('gemini-3.8-flash')).toBe('balanced');
      expect(getModelIntelligenceBand('claude-haiku-4-5')).toBe('economy');
    });

    it('resolves diverse peer challengers from distinct provider families for DeepSeek Flash 4.1', () => {
      const selection = resolvePeerChallengers({
        primaryModel: 'deepseek-v4-1-flash',
        count: 2,
      });

      expect(selection.primaryBand).toBe('balanced');
      expect(selection.challengers.length).toBe(2);
      // Primary is deepseek family; challengers must NOT be deepseek
      for (const challenger of selection.challengers) {
        expect(challenger).not.toBe('deepseek-v4-1-flash');
        expect(challenger).not.toBe('deepseek-v4-flash');
      }

      // Challengers must come from two distinct provider families
      const families = selection.challengers.map((c) => getModelBenchmark(c).family);
      expect(new Set(families).size).toBe(2);
    });

    it('resolves peer challengers in the high-end reasoning band for Claude Sonnet 5.5', () => {
      const selection = resolvePeerChallengers({
        primaryModel: 'claude-sonnet-5-5',
        count: 2,
      });

      expect(selection.primaryBand).toBe('high');
      expect(selection.challengers.length).toBe(2);
      // Primary is anthropic family; challengers must NOT be anthropic
      for (const challenger of selection.challengers) {
        expect(getModelBenchmark(challenger).family).not.toBe('anthropic');
      }

      const families = selection.challengers.map((c) => getModelBenchmark(c).family);
      expect(new Set(families).size).toBe(2);
    });

    it('expands to nearest score neighbor if an intelligence band lacks sufficient distinct families', () => {
      // Artificially filter isReady to simulate only OpenAI models available in balanced band
      const selection = resolvePeerChallengers({
        primaryModel: 'deepseek-v4-1-flash',
        count: 2,
        isReady: (tier) => {
          const meta = getModelBenchmark(tier);
          // Only OpenAI in balanced, but Anthropic in high/economy
          if (meta.intelligenceBand === 'balanced') return meta.family === 'openai';
          return meta.family === 'anthropic' || meta.family === 'openai';
        },
      });

      expect(selection.challengers.length).toBe(2);
      const families = selection.challengers.map((c) => getModelBenchmark(c).family);
      expect(new Set(families).size).toBe(2);
    });

    it('builds debate plan matched to primary model benchmark band and assigns distinct roles', () => {
      const codePlan = getDebatePlan('code', 'deepseek-v4-1-flash', 2);
      expect(codePlan.primaryBand).toBe('balanced');
      expect(codePlan.challengers.length).toBe(2);
      expect(codePlan.challengers[0]!.role).toBe('critic');
      expect(codePlan.challengers[1]!.role).toBe('implementer');
      expect(codePlan.challengers[0]!.modelTier).not.toBe('deepseek-v4-1-flash');
      expect(codePlan.challengers[1]!.modelTier).not.toBe('deepseek-v4-1-flash');

      const highCodePlan = getDebatePlan('code', 'claude-sonnet-5-5', 2);
      expect(highCodePlan.primaryBand).toBe('high');
      expect(highCodePlan.challengers[0]!.modelTier).not.toBe('claude-sonnet-5-5');
      expect(highCodePlan.challengers[1]!.modelTier).not.toBe('claude-sonnet-5-5');
    });
  });
});
