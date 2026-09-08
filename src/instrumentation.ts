/**
 * Next runs this once per server process. It is the natural home for the
 * background sweep that removes expired shares.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { sweepExpired, ensureDirs } = await import("@/lib/storage");
  ensureDirs();

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
}
