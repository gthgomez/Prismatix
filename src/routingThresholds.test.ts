import { describe, expect, it } from 'vitest';
import {
  complexityScoreRoutingHint,
  ROUTING_SCORE_GATES,
  ROUTING_SCORE_GATE_LEGEND,
} from './routingThresholds';

describe('complexityScoreRoutingHint', () => {
  it('mentions STRONG / Code Review tier at high text scores', () => {
    expect(complexityScoreRoutingHint(90)).toContain('STRONG');
    expect(complexityScoreRoutingHint(100)).toContain('STRONG');
  });

  it('uses ECONOMY tier at gate and below', () => {
    expect(complexityScoreRoutingHint(ROUTING_SCORE_GATES.ECONOMY_MAX)).toContain('ECONOMY');
    expect(complexityScoreRoutingHint(0)).toContain('ECONOMY');
  });

  it('uses FAST tier between economy and balanced', () => {
    expect(complexityScoreRoutingHint(50)).toContain('FAST');
    expect(complexityScoreRoutingHint(60)).toContain('FAST');
  });

  it('uses BALANCED tier between fast and strong', () => {
    expect(complexityScoreRoutingHint(72)).toContain('BALANCED');
    expect(complexityScoreRoutingHint(79)).toContain('BALANCED');
  });
});

describe('ROUTING_SCORE_GATE_LEGEND', () => {
  it('includes all published numeric gates', () => {
    const g = ROUTING_SCORE_GATES;
    expect(ROUTING_SCORE_GATE_LEGEND).toContain(String(g.ECONOMY_MAX));
    expect(ROUTING_SCORE_GATE_LEGEND).toContain(String(g.BALANCED_MIN));
    expect(ROUTING_SCORE_GATE_LEGEND).toContain(String(g.FAST_MIN));
    expect(ROUTING_SCORE_GATE_LEGEND).toContain(String(g.STRONG_MIN));
    expect(ROUTING_SCORE_GATE_LEGEND).toContain(String(g.MAX_REASONING_MIN));
    expect(ROUTING_SCORE_GATE_LEGEND).toContain(String(g.MAX_CONTEXT_TOKEN_THRESHOLD));
  });
});
