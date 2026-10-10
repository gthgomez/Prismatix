// scripts/reconcile-jobs.mjs
// Durable maintenance worker and cleanup utility for prismatix_internal.reconciliation_jobs.
//
// Usage:
//   node scripts/reconcile-jobs.mjs [--dry-run] [--limit 50] [--max-attempts 3] [--purge-days 30]

import { createClient } from '@supabase/supabase-js';

export async function processReconciliationBatch(supabase, options = {}) {
  const {
    dryRun = false,
    limit = 50,
    maxAttempts = 3,
    purgeDays = 30,
    logger = console,
  } = options;

  const summary = {
    scanned: 0,
    processed: 0,
    failed: 0,
    purged: 0,
  };

  // 1. Fetch pending jobs
  const { data: pendingJobs, error: fetchErr } = await supabase
    .schema('prismatix_internal')
    .from('reconciliation_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (fetchErr) {
    logger.error?.('[reconcile-jobs] Failed to query pending jobs:', fetchErr.message);
    throw fetchErr;
  }

  summary.scanned = pendingJobs?.length ?? 0;
  logger.log?.(`[reconcile-jobs] Found ${summary.scanned} pending reconciliation job(s).`);

  // 2. Process each pending job
  for (const job of pendingJobs ?? []) {
    const attempts = (job.attempts ?? 0) + 1;
    logger.log?.(`[reconcile-jobs] Inspecting job ${job.id} (kind: ${job.kind}, execution: ${job.execution_id})`);

    if (dryRun) {
      logger.log?.(`[reconcile-jobs] [DRY RUN] Would reconcile job ${job.id}`);
      summary.processed++;
      continue;
    }

    try {
      // Reconcile according to kind
      if (job.kind === 'receipt_projection_failed') {
        // Check execution state in ledger
        const { data: exec } = await supabase
          .schema('prismatix_internal')
          .from('executions')
          .select('id, status, settled_cost_usd')
          .eq('id', job.execution_id)
          .maybeSingle();

        if (exec && (exec.status === 'settled' || exec.status === 'cancelled')) {
          // Execution reached terminal state, receipt job is complete
          await supabase
            .schema('prismatix_internal')
            .from('reconciliation_jobs')
            .update({
              status: 'done',
              attempts,
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id);
          summary.processed++;
        } else {
          // Execution still open or missing; record attempt
          const status = attempts >= maxAttempts ? 'failed' : 'pending';
          await supabase
            .schema('prismatix_internal')
            .from('reconciliation_jobs')
            .update({
              status,
              attempts,
              last_error: exec ? 'execution_unsettled' : 'execution_not_found',
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id);
          if (status === 'failed') summary.failed++;
        }
      } else if (job.kind === 'refund_lease') {
        // Acknowledge lease reconciliation
        await supabase
          .schema('prismatix_internal')
          .from('reconciliation_jobs')
          .update({
            status: 'done',
            attempts,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        summary.processed++;
      } else {
        // Unknown job kind
        const status = attempts >= maxAttempts ? 'failed' : 'pending';
        await supabase
          .schema('prismatix_internal')
          .from('reconciliation_jobs')
          .update({
            status,
            attempts,
            last_error: `unknown_reconciliation_kind: ${job.kind}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        if (status === 'failed') summary.failed++;
      }
    } catch (jobErr) {
      logger.error?.(`[reconcile-jobs] Error reconciling job ${job.id}:`, jobErr);
      const status = attempts >= maxAttempts ? 'failed' : 'pending';
      await supabase
        .schema('prismatix_internal')
        .from('reconciliation_jobs')
        .update({
          status,
          attempts,
          last_error: String(jobErr),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      if (status === 'failed') summary.failed++;
    }
  }

  // 3. Purge aged terminal jobs if purgeDays configured
  if (purgeDays > 0) {
    const cutoffDate = new Date(Date.now() - purgeDays * 24 * 60 * 60 * 1000).toISOString();
    if (!dryRun) {
      const { data: purged, error: purgeErr } = await supabase
        .schema('prismatix_internal')
        .from('reconciliation_jobs')
        .delete()
        .in('status', ['done', 'failed'])
        .lt('updated_at', cutoffDate)
        .select('id');

      if (!purgeErr) {
        summary.purged = purged?.length ?? 0;
        if (summary.purged > 0) {
          logger.log?.(`[reconcile-jobs] Purged ${summary.purged} completed/failed job(s) older than ${purgeDays} days.`);
        }
      }
    }
  }

  return summary;
}

// CLI Execution entrypoint
if (process.argv[1] && process.argv[1].endsWith('reconcile-jobs.mjs')) {
  const isDryRun = process.argv.includes('--dry-run');
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn('[reconcile-jobs] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided for live reconciliation.');
    console.log('[reconcile-jobs] Dry-run demonstration mode.');
    process.exit(0);
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  processReconciliationBatch(client, { dryRun: isDryRun })
    .then((summary) => {
      console.log('[reconcile-jobs] Completed batch execution:', summary);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[reconcile-jobs] Unhandled batch failure:', err);
      process.exit(1);
    });
}
