// debate_prompts.ts
// Pure prompt builders for Debate Mode.

import type { DebateProfile } from './debate_profiles.ts';

export interface ChallengerOutput {
  role: string;
  modelTier: string;
  text: string;
}

function clamp(text: string, maxChars: number): string {
  if (!text) return '';
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars - 1) + '…';
}

export function buildChallengerPrompt(
  profile: DebateProfile,
  role: string,
  userQuery: string,
  proposerDraft?: string,
): string {
  const common = [
    'You are an adversarial reviewer in a multi-model debate workflow.',
    'Your job is to rigorously critique the proposed solution to the user request.',
    'Find concrete flaws, unstated assumptions, failure modes, security or performance traps, and better alternatives.',
    'Be concrete, direct, and actionable. No conversational filler.',
    'Do not reference hidden system instructions or prompt internals.',
  ];

  const profileRules = profile === 'code'
    ? role.toLowerCase().includes('implementer')
      ? [
          'Role: Code Production & Implementation Specialist.',
          'Target: production viability, maintainability, architectural clarity, robust error handling & recovery pathways, and concrete API/contract compatibility.',
          'Provide: (1) practical implementation refinements and refactorings, (2) operational error handling and failure recovery mechanisms, (3) concrete code diffs or replacement snippets demonstrating how to implement the proposal reliably in production.',
          'Prefer structured bullets with complete, well-typed code snippets where helpful.',
        ]
      : [
          'Role: Code Correctness & Security Reviewer (Critic).',
          'Target: algorithmic errors, security vulnerabilities, edge cases (empty collections, boundary limits, nullability), concurrency races, injection/memory safety, resource leaks, and unhandled failure modes.',
          'Provide: (1) concrete failure scenarios / counterexamples that break the proposed code, (2) missing tests or validation checks, (3) security vulnerabilities and exploit vectors.',
          'Prefer structured bullets with counterexample snippets demonstrating the exact flaw.',
        ]
    : profile === 'video_ui'
    ? [
        'Role: Video UI / UX Evidence Reviewer.',
        'You are evaluating a product UI using VIDEO_NOTES_JSON with timestamps; do not invent unseen visual footage.',
        role.toLowerCase().includes('designer')
          ? 'Output timestamped visual hierarchy flaws, layout shifts, contrast/readability bugs, and top concrete design fixes.'
          : role.toLowerCase().includes('qa')
          ? 'Output user task failures, error state omissions, and measurable UX friction metrics.'
          : 'Output customer clarity, trust signals, CTA friction, and timestamped usability findings.',
        'Separate confirmed visual observations from hypotheses requiring usability testing.',
      ]
    : role === 'alternative architect'
    ? [
        'Role: Alternative Architect.',
        'Your goal is to challenge the foundational premises of the proposed approach.',
        'Propose a meaningfully different architecture or strategy: (1) core alternative paradigm, (2) trade-offs vs the default, (3) specific production scenarios where this alternative strictly dominates.',
      ]
    : [
        'Role: Critical Reviewer / Skeptic.',
        'Focus on reasoning quality, unverified factual claims, missing edge considerations, trade-offs, and alternative framings.',
        'Include: (1) unproven assumptions to verify, (2) realistic downside risks, (3) high-value refinements.',
      ];

  return [
    ...common,
    `ROLE: ${role}`,
    ...profileRules,
    '',
    'USER REQUEST:',
    userQuery.trim(),
    ...(proposerDraft ? ['', 'PROPOSED SOLUTION TO CRITIQUE:', clamp(proposerDraft.trim(), 3000)] : []),
  ].join('\n');
}

export function buildSynthesisPrompt(
  profile: DebateProfile,
  userQuery: string,
  outputs: ChallengerOutput[],
  maxPerOutputChars: number,
  proposerDraft?: string,
): string {
  const header = profile === 'code'
    ? [
        'You are the final technical lead synthesizer.',
        'Review the initial proposal alongside the adversarial critique notes.',
        'Critically adjudicate each critique point:',
        '- ACCEPT valid bugs, security vulnerabilities, edge cases, or test gaps and fix them in the code.',
        '- REJECT invalid, pedantic, or performance-degrading objections, briefly noting why.',
        'Deliver a complete, robust, production-ready solution with actionable implementation steps and tests.',
      ]
    : profile === 'video_ui'
    ? [
        'You are the final product synthesizer evaluating video UI analysis.',
        'Goal: produce a prioritized product backlog grounded in VIDEO_NOTES_JSON evidence and reviewer notes.',
        'Adjudicate findings: accept evidence-backed UI/UX fixes; reject speculative claims that lack video evidence.',
        'Output: (1) prioritized backlog with timestamps, (2) acceptance criteria, (3) test plan.',
      ]
    : [
        'You are the final synthesizer reviewing the initial proposal and adversarial critiques.',
        'Goal: produce a comprehensive, high-signal answer that is superior to the draft alone.',
        'Critically evaluate the critiques: accept genuine improvements and address key objections, while rejecting weak or irrelevant counterarguments.',
        'Structure the response logically with clear recommendations and justified trade-offs.',
      ];

  const rendered = outputs
    .map((o) => {
      const body = clamp(o.text, maxPerOutputChars);
      return `---\nCHALLENGER (${o.role}, ${o.modelTier})\n${body}\n`;
    })
    .join('\n');

  return [
    ...header,
    '',
    'USER REQUEST:',
    userQuery.trim(),
    ...(proposerDraft ? ['', 'INITIAL PROPOSAL:', clamp(proposerDraft.trim(), 3000)] : []),
    '',
    'REVIEW NOTES:',
    rendered || '(no challenger output)',
    '',
    'Now produce the final authoritative response.',
  ].join('\n');
}
