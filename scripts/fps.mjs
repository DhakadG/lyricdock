// Frame-time probe for the phone (dev tool): node scripts/fps.mjs [frames]  -> median / p95 frame time of the live app.
// Optional: node scripts/fps.mjs 300 "Settings.set('blurLines', false)"  runs the JS first (then restores nothing).
import { call, ws } from './cdp.mjs';
const [, , n = '300', pre = ''] = process.argv;
const expr = `(async () => { ${pre}; await new Promise(r => setTimeout(r, 1500));
  return await new Promise(r => { const d = []; let l = performance.now(); const f = t => { d.push(t - l); l = t;
    if (d.length < ${+n}) requestAnimationFrame(f); else { d.sort((a, b) => a - b); const q = x => d[Math.floor(d.length * x)].toFixed(1);
      r(JSON.stringify({ p50: q(.5), p90: q(.9), p99: q(.99), slow: d.filter(x => x > 20).length + '/' + d.length })); } };
    requestAnimationFrame(f); }); })()`;
const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(r.exceptionDetails ? 'ERROR ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text) : r.result.value);
ws.close();
