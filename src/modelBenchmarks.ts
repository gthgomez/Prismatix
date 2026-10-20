// src/modelBenchmarks.ts — Client access to the Standardized AI Benchmark Registry
// Re-exports benchmark metadata and provides presentation helpers for Debate Mode.

export {
  BENCHMARK_REGISTRY_VERSION,
  INTELLIGENCE_BAND_DEFINITIONS,
  MODEL_BENCHMARKS,
  getModelBenchmark,
  getModelIntelligenceBand,
  calculateBlendedCostPer1M,
  resolvePeerChallengers,
  type IntelligenceBand,
  type ModelBenchmarkEntry,
  type ResolvedPeerSelection,
} from '../supabase/functions/_shared/model_benchmarks';
