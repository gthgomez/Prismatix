import { describe, expect, it } from 'vitest';
import {
  complexityScoreRoutingHint,
  ROUTING_SCORE_GATES,
  ROUTING_SCORE_GATE_LEGEND,
} from './routingThresholds';

describe('complexityScoreRoutingHint', () => {
  it('mentions Sonnet tier at high text scores', () => {
    expect(complexityScoreRoutingHint(90)).toContain('Sonnet');
    expect(complexityScoreRoutingHint(100)).toContain('Sonnet');
  });

  it('uses mini band at gate and below', () => {
    expect(complexityScoreRoutingHint(ROUTING_SCORE_GATES.GPT_MINI_MAX)).toContain(
      String(ROUTING_SCORE_GATES.GPT_MINI_MAX),
    );
    expect(complexityScoreRoutingHint(0)).toContain(String(ROUTING_SCORE_GATES.GPT_MINI_MAX));
  });

  it('uses Haiku band between mini and Qwen', () => {
    expect(complexityScoreRoutingHint(25)).toContain('Haiku');
    expect(complexityScoreRoutingHint(20)).toContain('Haiku');
  });

  it('uses Qwen and DeepSeek bands', () => {
    expect(complexityScoreRoutingHint(40)).toContain('Qwen');
    expect(complexityScoreRoutingHint(60)).toContain('DeepSeek');
  });

  it('uses Flash band between DeepSeek and Sonnet text gate', () => {
    expect(complexityScoreRoutingHint(72)).toContain('Flash');
    expect(complexityScoreRoutingHint(79)).toContain('Flash');
  });
});

describe('ROUTING_SCORE_GATE_LEGEND', () => {
  it('includes all published numeric gates', () => {
    const g = ROUTING_SCORE_GATES;
    expect(ROUTING_SCORE_GATE_LEGEND).toContain(String(g.GPT_MINI_MAX));
    expect(ROUTING_SCORE_GATE_LEGEND).toContain(String(g.HAIKU_MAX));
    expect(ROUTING_SCORE_GATE_LEGEND).toContain(String(g.ROUTE_QWEN_MIN));
    expect(ROUTING_SCORE_GATE_LEGEND).toContain(String(g.IMAGES_PRO_MIN));
    expect(ROUTING_SCORE_GATE_LEGEND).toContain(String(g.OPUS_REASONING_MIN));
    expect(ROUTING_SCORE_GATE_LEGEND).toContain(String(g.OPUS_CONTEXT_TOKEN_THRESHOLD));
  });
});
