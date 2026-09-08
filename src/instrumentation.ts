/**
 * Next runs this once per server process, and treats a rejection here as
 * fatal — every route then fails before it runs. So nothing in this file may
 * throw, however broken the environment is.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { sweepExpired, ensureDirs } = await import("@/lib/storage");

    const storage = ensureDirs();
    if (!storage.writable) {
      // Expected on a serverless host: there is no durable disk to sweep, and
      // file sharing reports itself unavailable. The other tools still work.
      console.warn(`[storage] file sharing disabled: ${storage.reason}`);
      return;
    }

    const runSweep = async () => {
      try {
        const removed = await sweepExpired();
        if (removed > 0) console.log(`[sweep] removed ${removed} expired file(s)`);
      } catch (error) {
        console.error("[sweep] failed", error);
      }
    };

    void runSweep();
    const timer = setInterval(runSweep, 15 * 60 * 1000);
    timer.unref?.();
  } catch (error) {
    console.error("[instrumentation] startup check failed", error);
  }
}
