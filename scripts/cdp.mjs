// Drive the phone app's WebView over Chrome DevTools Protocol (adb forward tcp:9333 -> webview_devtools_remote_<pid>).
// node scripts/cdp.mjs eval "<js expression>"      -> prints the result
// node scripts/cdp.mjs shot out.png                -> screenshot of the page
// The other phone dev scripts import their connection from here: import { call, ev, sleep, touch, screencap, ws } from './cdp.mjs'
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const list = await (await fetch('http://127.0.0.1:9333/json')).json();
export const ws = new WebSocket(list.find(p => p.url.includes('android_asset')).webSocketDebuggerUrl);
let id = 0;
export const call = (method, params = {}) => new Promise((res, rej) => {
  const my = ++id;
  const on = e => { const m = JSON.parse(e.data); if (m.id !== my) return; ws.removeEventListener('message', on); m.error ? rej(new Error(m.error.message)) : res(m.result); };
  ws.addEventListener('message', on);
  ws.send(JSON.stringify({ id: my, method, params }));
});
await new Promise(r => ws.addEventListener('open', r));
// A JS expression in the page -> its value (promises awaited); a page exception throws here.
export const ev = async expr => {
  const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
export const sleep = t => new Promise(r => setTimeout(r, t));
export const touch = (type, x, y) => call('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
// Real pixels (CDP screenshots leave out WebGL), through the adb that scripts/find-adb.ps1 picks.
let adb;
export const screencap = file => {
  adb ??= process.env.ADB || execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('find-adb.ps1', import.meta.url))], { encoding: 'utf8' }).trim();
  fs.writeFileSync(file, execFileSync(adb, ['exec-out', 'screencap', '-p'], { maxBuffer: 64e6 }));
};

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [, , cmd, arg] = process.argv;
  if (cmd === 'eval') console.log(await ev(arg).then(v => JSON.stringify(v), e => 'ERROR: ' + e.message));
  else if (cmd === 'shot') { fs.writeFileSync(arg, Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64')); console.log('saved', arg); }
  ws.close();
}
