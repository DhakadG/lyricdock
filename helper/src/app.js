// LyricDock Helper UI (Tauri 2, withGlobalTauri). Pages switch in place; the Rust side does the work.
const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
const $ = id => document.getElementById(id);
const toast = (text, bad) => {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' error' : '');
  t.textContent = text;
  $('toasts').append(t);
  setTimeout(() => t.remove(), 3500);
};
if (!document.fonts.check('16px "Segoe Fluent Icons"') && !document.fonts.check('16px "Segoe MDL2 Assets"')) document.body.classList.add('no-fluent');

// ---- navigation
document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => {
  document.querySelectorAll('.nav-item').forEach(x => x.removeAttribute('aria-current'));
  b.setAttribute('aria-current', 'page');
  document.querySelectorAll('.page').forEach(p => { p.hidden = p.id !== `page-${b.dataset.page}`; });
  live(b.dataset.page === 'developer' && $('dev-live').checked);
});
document.addEventListener('click', e => { const u = e.target.closest('[data-url]')?.dataset.url; if (u) invoke('open_url', { url: u }).catch(err => toast(String(err), true)); });

// ---- status
let st = null;
async function refresh() {
  st = await invoke('status');
  const ok = st.spicetify && st.loader_installed && st.enabled;
  const cls = !st.spicetify ? 's-bad' : ok ? 's-ok' : 's-warn';
  $('ring').className = `ring ${cls}`;
  $('ext-badge').className = `badge ${cls}`;
  $('ext-badge').textContent = !st.spicetify ? 'Spicetify missing' : ok ? 'Installed' : st.loader_installed ? 'Not enabled' : 'Not installed';
  $('ext-title').textContent = ok ? 'Ready' : 'Needs attention';
  $('ext-sub').textContent = !st.spicetify ? 'Install Spicetify first, then click Install / repair.'
    : ok ? 'The auto-updating loader is installed and enabled in Spicetify.' : 'Click Install / repair to set it up.';
  $('banner-spicetify').hidden = !!st.spicetify;
  const chip = (k, v) => `<span class="chip">${k} <b>${v}</b></span>`;
  $('chips').innerHTML = chip('Spicetify', st.spicetify ? 'found' : 'missing') + chip('Loader', st.loader_installed ? 'installed' : 'missing')
    + chip('Enabled', st.enabled ? 'yes' : 'no') + (st.dev_copy ? chip('Dev copy', 'present') : '');
  $('st-helper').textContent = `v${st.version}`;
  $('st-auto').textContent = st.autostart ? 'On' : 'Off';
  $('set-auto').checked = st.autostart;
  $('ab-ver').textContent = st.version; $('ab-spice').textContent = st.spicetify || 'not found';
  $('ab-ext').textContent = st.extensions_dir || '—'; $('ab-adb').textContent = st.adb || 'not installed (not needed)';
  $('btn-link').textContent = st.link_running ? 'Stop' : 'Start';
  $('dev-link-sub').textContent = st.link_running ? 'Running - Spotify reaches the phone over adb too.' : 'Stopped. Points Spotify\'s localhost:8975 at the phone over adb (development path).';
  fetch('https://raw.githubusercontent.com/DhakadG/lyricdock/main/extension/version.json', { cache: 'no-store' })
    .then(r => r.json()).then(j => { $('st-latest').textContent = `v${j.version}`; }).catch(() => { $('st-latest').textContent = 'offline'; });
}
$('btn-refresh').onclick = () => refresh().then(() => toast('Status updated'));
$('btn-install').onclick = () => invoke('install_extension').then(() => toast('Installer opened in a PowerShell window')).catch(e => toast(String(e), true));
$('btn-kiosk').onclick = () => invoke('setup_phone').then(() => toast('Phone setup opened in a PowerShell window')).catch(e => toast(String(e), true));

// ---- settings
$('set-auto').onchange = e => invoke('set_autostart', { on: e.target.checked }).then(() => toast(e.target.checked ? 'Starts with Windows' : 'No longer starts with Windows'))
  .catch(err => { e.target.checked = !e.target.checked; toast(String(err), true); });
const devOn = localStorage.getItem('dev') === '1';
$('set-dev').checked = devOn; $('nav-dev').hidden = !devOn;
$('set-dev').onchange = e => { localStorage.setItem('dev', e.target.checked ? '1' : '0'); $('nav-dev').hidden = !e.target.checked; };

// ---- developer
$('btn-link').onclick = async () => { const run = await invoke('link', { start: !st?.link_running }).catch(e => toast(String(e), true)); st.link_running = run; refresh(); };
$('btn-restart').onclick = () => invoke('phone', { action: 'restart' }).then(() => toast('App restarted on the phone')).catch(e => toast(String(e), true));
let liveT = null;
let shooting = false;
async function shot() {
  if (shooting) return; // previous capture still running: skip this tick
  shooting = true;
  try { await shot1(); } finally { shooting = false; }
}
async function shot1() {
  try { const b = await invoke('phone', { action: 'screen' }); $('shot').style.backgroundImage = `url(data:image/png;base64,${b})`; } catch (e) { /* no phone */ }
  try { $('dev-devices').textContent = (await invoke('phone', { action: 'devices' })).split('\n').slice(1).join(' · ') || 'No phone on adb'; } catch (e) { $('dev-devices').textContent = 'adb not found'; }
}
function live(on) { clearInterval(liveT); if (on) { shot(); liveT = setInterval(shot, 2000); } }
$('dev-live').onchange = e => live(e.target.checked);
$('shot').onclick = shot;

// ---- local signalling relay
async function relayUi(info) {
  info ??= await invoke('relay_status');
  $('set-relay').checked = info.running;
  $('st-relay').textContent = info.running ? (info.ip ?? 'On') : 'Off';
  $('relay-sub').textContent = info.running
    ? `Running on ${info.ip ?? 'this PC'}:${info.port}. On each phone: Settings → Connection → Signalling server → LyricDock Helper, address ${info.ip ?? '(this PC\'s IP)'}. Windows may ask once to allow it on private networks - click Allow.`
    : 'Pairing and connection setup stay on your network instead of ntfy.sh. Turn on, then set the phone to use it.';
}
$('set-relay').onchange = e => invoke('relay_set', { on: e.target.checked }).then(i => { relayUi(i); toast(i.running ? 'Local relay running' : 'Local relay stopped'); })
  .catch(err => { e.target.checked = false; toast(String(err), true); });
relayUi().catch(() => {});

// ---- update notifications (the extension and the phone update themselves; this just says so)
$('set-notify').checked = localStorage.getItem('notify') !== '0';
$('set-notify').onchange = e => localStorage.setItem('notify', e.target.checked ? '1' : '0');
async function notifyUpdate() {
  if (localStorage.getItem('notify') === '0') return;
  try {
    const v = (await (await fetch('https://raw.githubusercontent.com/DhakadG/lyricdock/main/extension/version.json', { cache: 'no-store' })).json()).version;
    if (!/^\d+\.\d+\.\d+$/.test(v) || localStorage.getItem('notified') === v) return;
    const first = !localStorage.getItem('notified');
    localStorage.setItem('notified', v);
    if (first) return; // don't announce the version that was current at install
    const n = window.__TAURI__.notification;
    if (!(await n.isPermissionGranted()) && (await n.requestPermission()) !== 'granted') return;
    n.sendNotification({ title: `LyricDock ${v} is out`, body: 'Spotify picks it up by itself (Update in the LyricDock popup), the phone within 6 hours. Release notes: Dashboard → Release notes.' });
  } catch (e) {}
}
notifyUpdate();
setInterval(notifyUpdate, 3 * 3600 * 1000);

// ---- kiosk setup wizard (the real work is the setup-phone.ps1 console it opens at the end)
const WZ = [
  ['Pick the phone', 'Use a phone you can dedicate to LyricDock. Kiosk mode needs no Google or Samsung accounts on it: remove them (Settings → Accounts) or start from a factory reset. Charge it and keep the cable handy.'],
  ['Turn on developer options', 'On the phone: Settings → About phone → Software information → tap Build number seven times until it says developer mode is on.'],
  ['Turn on USB debugging', 'Settings → Developer options → USB debugging on. Connect the phone to this PC with a data cable (not a charge-only one).'],
  ['Run the setup', 'The next button opens a PowerShell window that downloads adb for a moment, installs LyricDock, makes it the kiosk (full screen, starts on boot, silent updates) and deletes adb again. When the phone asks "Allow USB debugging?", tick Always allow and tap Allow.'],
  ['Pair it', 'The phone shows a pairing code. In Spotify, click the LyricDock button in the top bar and enter it under Phones - or sign the phone in to your Spotify account and it finds your PC by itself. You can turn USB debugging off afterwards.'],
];
let wz = 0;
function wzShow() {
  $('wz-dots').innerHTML = WZ.map((_, i) => `<i class="${i <= wz ? 'on' : ''}"></i>`).join('');
  $('wz-count').textContent = `${wz + 1} of ${WZ.length}`;
  $('wz-title').textContent = WZ[wz][0];
  $('wz-text').textContent = WZ[wz][1];
  $('wz-back').disabled = wz === 0;
  $('wz-next').textContent = wz === 3 ? 'Run phone setup' : wz === WZ.length - 1 ? 'Start over' : 'Next';
}
$('wz-back').onclick = () => { wz = Math.max(0, wz - 1); wzShow(); };
$('wz-next').onclick = () => {
  if (wz === 3) invoke('setup_phone').then(() => toast('Phone setup opened in a PowerShell window')).catch(e => toast(String(e), true));
  wz = wz === WZ.length - 1 ? 0 : wz + 1;
  wzShow();
};
wzShow();

// ---- help
const FAQ = [
  ['Do I need this helper?', 'No. Spotify and the phone talk to each other directly. The helper installs or repairs the Spotify extension, runs the one-time phone setup, and can host a local signalling relay.'],
  ['The LyricDock button is gone from Spotify', 'Spotify updates can remove Spicetify. Click Install / repair on the Dashboard (or run spicetify backup apply), then restart Spotify.'],
  ['The phone says "Waiting for Spotify"', 'Pair once: enter the code the phone shows in Spotify → LyricDock → Phones. Both must be on the same network (or set a TURN server for away-from-home use). If your router isolates devices, use USB tethering or the local relay.'],
  ['Can I use several phones?', 'Yes. Pair each one in Spotify → LyricDock → Phones. They all follow the same Spotify, and each keeps its own settings (Edit settings next to its name).'],
  ['Does it work without Spicetify?', 'Yes, in Spotify-account mode: put your own Spotify Client ID in the phone\'s Settings → Playback source and sign in. It follows whatever device your account plays on.'],
  ['What goes through ntfy.sh?', 'Only the encrypted one-time connection setup (keys derived from the pairing code). Music, lyrics and commands go directly between Spotify and the phone. Turn on the local relay to keep even that at home.'],
  ['Why no lyrics for some songs?', 'LyricDock uses Spicy Lyrics\' cache on this PC, Spotify\'s lyrics and LRCLIB. Songs none of them have show "No lyrics". A Spicy Lyrics publishable key on the phone fills more gaps.'],
  ['How do I roll back a bad update?', 'Spotify → LyricDock → Update channel and version → pick an older version. Choose Latest again to resume updates.'],
  ['How do I leave kiosk mode?', 'On the phone: Settings → Connection → Kiosk mode → Leave (tap twice).'],
];
$('faq').innerHTML = FAQ.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('');

$('btn-quit').onclick = () => invoke('quit');
refresh().catch(e => toast(String(e), true));
setInterval(() => refresh().catch(() => {}), 15000);
