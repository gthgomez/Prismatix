// Runtime seam keeps contracts and handlers importable by Node tests.
type Runtime = {
  Deno?: {
    env: { get(name: string): string | undefined };
    serve(handler: (req: Request) => Promise<Response>): unknown;
  };
  EdgeRuntime?: { waitUntil(task: Promise<unknown>): void };
};
export const runtime = globalThis as unknown as Runtime;
export const readEnv = (name: string): string | undefined => runtime.Deno?.env.get(name);
export function keepAlive(task: Promise<unknown>): void {
  const safe = task.catch(() => {
    console.warn('[Memory] background task failed; durable job retained');
  });
  if (runtime.EdgeRuntime) runtime.EdgeRuntime.waitUntil(safe);
  else void safe;
}
