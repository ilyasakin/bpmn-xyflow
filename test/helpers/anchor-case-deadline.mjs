/** A timed-out workflow closes its own page; subsequent isolated cases still run. */
export async function withAnchorDeadline(page, action, { milliseconds = 90000, cleanupMilliseconds = 5000, onTimeout = async () => {} } = {}) {
  let timer;
  let cleanup;
  const running = Promise.resolve().then(action);
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Native anchor workflow exceeded ${milliseconds}ms`);
      // Settle the race before evidence capture or page cleanup can let a late
      // action finish successfully. The caller still awaits bounded cleanup.
      reject(error);
      const bounded = async action => {
        let cleanupTimer;
        try { await Promise.race([Promise.resolve().then(action).catch(() => {}), new Promise(resolve => { cleanupTimer = setTimeout(resolve, cleanupMilliseconds); })]); }
        finally { clearTimeout(cleanupTimer); }
      };
      cleanup = bounded(onTimeout).then(() => bounded(() => page.close()));
    }, milliseconds);
  });
  try { return await Promise.race([running, expired]); }
  finally { clearTimeout(timer); await cleanup; }
}

export function selectAnchorCases(cases, { batch, id, engine } = {}) {
  const selected = cases.filter(c => (!batch || c.batch === batch) && (!id || c.id === id) && (!engine || c.engine === engine));
  if (!selected.length) throw new Error('No native cases match the requested batch/case/engine');
  const keys = selected.map(c => `${c.id}-${c.engine}-${c.name}`);
  if (new Set(keys).size !== keys.length) throw new Error('Native case keys must be unique');
  return selected;
}
