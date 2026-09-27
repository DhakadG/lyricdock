// Writes the flip clock's digit cards (designed in Figma: page "LyricDock · Flip Clock", component set "Flip digit")
// to design/flipclock/ as standalone SVGs, from the paths flipclock.js uses. node scripts/flip-assets.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
const src = readFileSync(new URL('../android/app/src/main/assets/flipclock.js', import.meta.url), 'utf8');
const grab = (start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));
const D = Function(`return ${grab('const D = {', '};').slice(10)}}`)();
const defs = Function(`return ${grab("const DEFS = '", ';\n').slice(13)}`)().replace(/^<svg[^>]*>|<\/svg>$/g, '');
const body = Function(`return ${grab("const CARD = '", ';\n').slice(13)}`)();
const out = new URL('../design/flipclock/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) rmSync(new URL(f, out));
const num = d => `<path transform="translate(150 220) scale(1.15) translate(-150 -220)" d="${D[d]}" fill="none" stroke="#FFFFFF" stroke-opacity="0.74" stroke-width="46.5" stroke-miterlimit="2.5"/>`;
const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="440" viewBox="0 0 300 440">${defs}${inner}</svg>\n`;
for (const d of Object.keys(D)) {
  writeFileSync(new URL(`card-${d}.svg`, out), svg(`${body}${num(d)}<rect y="218.5" width="300" height="3" fill="#000"/>`));
  writeFileSync(new URL(`numeral-${d}.svg`, out), svg(num(d)));
}
writeFileSync(new URL('card-blank.svg', out), svg(`${body}<rect y="218.5" width="300" height="3" fill="#000"/>`));
console.log(`wrote ${Object.keys(D).length * 2 + 1} SVGs to design/flipclock/`);
