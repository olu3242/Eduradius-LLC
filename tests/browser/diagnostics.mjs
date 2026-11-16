// Failure diagnostics for the browser journeys (local only). When DIAG_DIR is set, every
// context is traced; on failure the suite writes diag.json (failing step, last passed check,
// console and page errors, failed and 5xx requests) and a Playwright trace into DIAG_DIR.
// Nothing is kept for passing runs. Output is redacted: query values, e-mail addresses and
// bearer/cookie values are removed. Traces may still hold synthetic page content and the
// loopback development session cookie, so keep DIAG_DIR outside the repository (outputs/ is
// git-ignored) and never attach traces from hosted environments to tickets.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const redact = text => String(text ?? '')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
  .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
  .replace(/(eduradius_ws=)[^;\s]+/g, '$1<redacted>')
  .slice(0, 400);
const redactUrl = raw => { try { const u = new URL(raw); return u.pathname + (u.search ? '?' + [...u.searchParams.keys()].join('&') : ''); } catch { return '<url>'; } };

export function diagnostics(suite) {
  const dir = process.env.DIAG_DIR || null;
  const state = { suite, startedAt: new Date().toISOString(), lastPassed: null, firstFailedCheck: null, console: [], pageErrors: [], failedRequests: [], serverErrors: [], recent: [] };
  const contexts = [];
  const push = (list, item, max = 50) => { list.push(item); if (list.length > max) list.shift(); };
  function watch(page, label) {
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) push(state.console, { page: label, type: m.type(), text: redact(m.text()) }); });
    page.on('pageerror', e => push(state.pageErrors, { page: label, message: redact(e.message) }));
    page.on('requestfailed', r => push(state.failedRequests, { page: label, method: r.method(), url: redactUrl(r.url()), failure: redact(r.failure()?.errorText) }));
    page.on('response', r => {
      const url = redactUrl(r.url());
      if (url.startsWith('/api/')) push(state.recent, { at: Date.now(), status: r.status(), method: r.request().method(), url }, 30);
      if (r.status() >= 500) push(state.serverErrors, { page: label, status: r.status(), url, requestId: r.headers()['x-request-id'] ?? null });
    });
  }
  return {
    state,
    async attach(context, label) {
      contexts.push(context);
      if (dir) await context.tracing.start({ screenshots: true, snapshots: true, title: `${suite} ${label}` });
      context.on('page', p => watch(p, label));
    },
    checked(name, pass) { if (pass) state.lastPassed = name; else state.firstFailedCheck ??= name; },
    /** Writes diagnostics for a failed run (exception or failed checks). */
    async fail(error) {
      if (!dir) return;
      mkdirSync(dir, { recursive: true });
      const stack = String(error?.stack ?? '').split('\n').filter(l => l.includes('tests/browser/')).slice(0, 5).map(l => l.trim());
      writeFileSync(join(dir, 'diag.json'), JSON.stringify({
        ...state, endedAt: new Date().toISOString(), outcome: error ? 'exception' : 'failed-checks',
        error: error ? { name: error.name, message: redact(error.message).split('\n')[0], suiteLines: stack } : null,
      }, null, 1));
      for (const [i, context] of contexts.entries()) { try { await context.tracing.stop({ path: join(dir, `trace-${i}.zip`) }); } catch { /* context already closed */ } }
    },
    async discard() { for (const context of contexts) { try { await context.tracing.stop(); } catch { /* closed */ } } },
  };
}
