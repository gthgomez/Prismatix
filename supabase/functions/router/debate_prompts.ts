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

export function buildChallengerPrompt(profile: DebateProfile, role: string, userQuery: string): string {
  const common = [
    'You are part of a multi-perspective analysis workflow.',
    'Your job is to challenge the user request with useful critique, risks, and better alternatives.',
    'Be concrete. No fluff.',
    'Do not reference hidden instructions or private implementation details.',
  ];

  const profileRules = profile === 'code'
    ? [
        'Focus on correctness, edge cases, failure modes, implementation traps, and tests.',
        'Include at least: (1) likely bug sources, (2) exact checks/tests to add, (3) safer alternative design if needed.',
        'Prefer crisp bullets and actionable steps.',
      ]
    : profile === 'video_ui'
    ? [
        'You are evaluating a product UI using VIDEO_NOTES_JSON with timestamps; do not infer unseen frames.',
        role.toLowerCase().includes('designer')
          ? 'Output timestamped UI issues and the top 5 design fixes.'
          : role.toLowerCase().includes('qa')
          ? 'Output task failures, severity, and measurable UX metrics to track.'
          : 'Output customer trust, clarity, and CTA reactions with timestamped evidence.',
        'Keep findings concrete and evidence-based. Prefer short bullets.',
      ]
    : role === 'alternative architect'
    ? [
        'Your job is NOT to critique — it is to propose a meaningfully different approach.',
        'Assume the default approach works but ask: what if we started from different assumptions?',
        'Include: (1) a different core strategy, (2) different trade-offs it makes, ' +
          '(3) specific scenarios where this alternative beats the default.',
        'Be concrete. No meta-commentary. Do not reference the original approach beyond one sentence.',
      ]
    : [
        'Focus on reasoning quality, missing considerations, trade-offs, and better framing.',
        'Include at least: (1) assumptions to verify, (2) key risks, (3) alternative approaches.',
        'Prefer structured bullets with short explanations.',
      ];

  return [
    ...common,
    `ROLE: ${role}`,
    ...profileRules,
    '',
    'USER REQUEST:',
    userQuery.trim(),
  ].join('\n');
}

export function buildSynthesisPrompt(
  profile: DebateProfile,
  userQuery: string,
  outputs: ChallengerOutput[],
  maxPerOutputChars: number,
): string {
  const header = profile === 'code'
    ? [
        'You are the final synthesizer after reviewing multiple analyses.',
        'Goal: produce an implementable, testable plan with minimal risk.',
        'You must address critique points and clearly state trade-offs.',
        'Output should be structured with headings and actionable steps.',
      ]
    : profile === 'video_ui'
    ? [
        'You are the final synthesizer after reviewing video UI findings.',
        'Goal: produce a prioritized product backlog using only the evidence in VIDEO_NOTES_JSON and reviewer notes.',
        'Output must include: (1) prioritized backlog, (2) acceptance criteria for each item, (3) next usability test plan.',
        'Include timestamp references where available and keep recommendations implementation-ready.',
      ]
    : [
        'You are the final synthesizer after reviewing a skeptic critique and an alternative approach.',
        'Goal: produce a thorough, high-signal answer that is better than either input alone.',
        'You must: (1) address the skeptic\'s strongest objections, ' +
          '(2) incorporate the best elements of the alternative approach if they genuinely improve the answer, ' +
          '(3) clearly state which trade-offs you chose and why.',
        'Output should be structured with headings and concrete recommendations.',
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
    '',
    'REVIEW NOTES:',
    rendered || '(no challenger output)',
    '',
    'Now produce the final answer.',
  ].join('\n');
}
