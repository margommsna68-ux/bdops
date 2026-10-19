#!/usr/bin/env node
// Builds src/app/theme-bronze.generated.css for the "Đồng ấm" theme (data-theme="bronze", owner brief 19/10/2026).
// Every rule is scoped to [data-theme="bronze"], so Sáng / Tối / Vàng kim never change. Two parts:
//   1. Tailwind colour utilities that the source really uses (scanned from src/**/*.tsx|ts): grey → warm brown, blue → bronze,
//      green / emerald / lime → olive, yellow / amber / orange → amber, red / rose → brick; teal, purple, indigo, sky… keep their own
//      hue (they carry business meaning, e.g. Chung mooon–Genjy is teal).
//   2. Hard-coded colours in the app's own CSS (globals.css light rules, proxy-management.css, vm-grid.css, dashboard.css): each
//      declaration holding a Tailwind palette colour (hex or rgba) is re-emitted with the matching bronze colour, same alpha.
// Text colours are darkened step by step until they reach 4.5:1 on the card colour, so small text stays readable.
// Hand-written parts (tokens, sidebar, login, PIN, toasts, charts) live in src/app/theme-bronze.css, loaded after this file.
// Run after changing colours in those CSS files or adding new colour classes:  node scripts/build-bronze-theme.cjs
const fs = require('fs'), path = require('path'), postcss = require('postcss'), tw = require('tailwindcss/colors');
const root = path.join(__dirname, '..'), out = path.join(root, 'src/app/theme-bronze.generated.css');
const T = '[data-theme="bronze"]';
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const scale = a => Object.fromEntries(SHADES.map((s, i) => [s, a[i]]));
const P = {
  // Warm neutrals: page #FAF6EF, header #F3E8D7, light border #EAD9C2, strong border #C9A87E, main text #3A2A1C.
  bgN: scale(['#FAF6EF', '#F3E8D7', '#EAD9C2', '#DCC6A7', '#C9A87E', '#A88E72', '#8A735C', '#6F5A45', '#4A3726', '#3A2A1C', '#2A1E13']),
  bdN: scale(['#F3E8D7', '#EFE2CE', '#EAD9C2', '#DCC6A7', '#C9A87E', '#A88E72', '#8A735C', '#6F5A45', '#4A3726', '#3A2A1C', '#2A1E13']),
  txN: scale(['#FAF6EF', '#F3E8D7', '#EAD9C2', '#A88E72', '#7A6450', '#73604C', '#65503C', '#4E3B2A', '#3F2F20', '#3A2A1C', '#2A1E13']),
  bronze: scale(['#FBF4EA', '#F3E4CF', '#E9D0B0', '#D7B48C', '#BF8D5C', '#A9713F', '#8C5A2B', '#744820', '#5E3A19', '#4A2E14', '#36210E']),
  olive: scale(['#F3F5E6', '#E5EACB', '#D0D8A4', '#B3BE76', '#8F9B4C', '#737F36', '#5D692A', '#4B5522', '#3C441C', '#2E3416', '#20250F']),
  amber: scale(['#FBF3E1', '#F6E5BE', '#EDCF8C', '#E0B35A', '#CF9734', '#B57D20', '#976516', '#7A5012', '#5F3E0F', '#4A300C', '#352208']),
  brick: scale(['#F9EDE9', '#F2D9D1', '#E6BAAC', '#D49381', '#BE6B55', '#A6503A', '#93412D', '#7A3525', '#632B1F', '#4E2218', '#371710']),
};
const FAMILY = { gray: 'N', slate: 'N', zinc: 'N', neutral: 'N', stone: 'N', blue: 'bronze', green: 'olive', emerald: 'olive', lime: 'olive', yellow: 'amber', amber: 'amber', orange: 'amber', red: 'brick', rose: 'brick' };
const CARD = '#FFFDF9', WHITE_BG = '#FFFDF9', WHITE_TEXT = '#FFFAF2';
// ── colour helpers ──
const rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lum = h => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
const withAlpha = (h, a) => a == null || a >= 1 ? h : `rgba(${rgb(h).join(',')},${+a.toFixed(3)})`;
function pick(family, shade, role) {
  const f = FAMILY[family]; if (!f) return null;
  const pal = f === 'N' ? (role === 'text' ? P.txN : role === 'border' ? P.bdN : P.bgN) : P[f];
  let i = SHADES.indexOf(shade); if (i < 0) return null;
  // Text sits on cream: step darker until it reads (4.5:1). Light shades (50–300) are only used as text on dark surfaces; keep them.
  if (role === 'text' && i >= 4) while (i < SHADES.length - 1 && contrast(pal[SHADES[i]], CARD) < 4.5) i++;
  return pal[SHADES[i]];
}
// Reverse lookup of Tailwind's palette: '#1d4ed8' / '29,78,216' → ['blue','700'].
const byHex = {}, byRgb = {};
for (const fam of Object.keys(FAMILY)) for (const s of SHADES) { const h = tw[fam]?.[s]; if (!h) continue; byHex[h.toLowerCase()] = [fam, s]; byRgb[rgb(h).join(',')] = [fam, s]; }
const roleOf = prop => /^(color|fill|stroke|caret-color|-webkit-text-fill-color)$/.test(prop) ? 'text' : /border|outline|box-shadow|ring|accent/.test(prop) ? 'border' : 'bg';
function recolor(value, prop) {
  let changed = false; const role = roleOf(prop);
  let v = value.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, m => { const long = m.length === 4 ? '#' + m.slice(1).split('').map(c => c + c).join('') : m; const hit = byHex[long.toLowerCase()]; if (!hit) return m; const c = pick(hit[0], hit[1], role); if (!c) return m; changed = true; return c; });
  v = v.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/g, (m, r, g, b, a) => { const hit = byRgb[`${r},${g},${b}`]; if (!hit) return m; const c = pick(hit[0], hit[1], role); if (!c) return m; changed = true; return withAlpha(c, a == null ? null : parseFloat(a)); });
  // white on its own stays white-ish but warm (cards / text on bronze buttons)
  v = v.replace(/(^|[\s,(:])(#fff(?:fff)?|white)\b/gi, (m, p) => { changed = true; return p + (role === 'text' ? WHITE_TEXT : WHITE_BG); });
  return changed ? v : null;
}
// ── part 1: Tailwind utilities used in the source ──
const files = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); } else if (/\.(tsx|ts)$/.test(e.name)) files.push(p); } })(path.join(root, 'src'));
const CORE = String.raw`((?:hover|focus|focus-visible|focus-within|active|disabled|group-hover|placeholder):)?(bg|text|border|border-[trblxy]|ring|divide|fill|stroke|accent)-(white|(?:gray|slate|zinc|neutral|stone|blue|green|emerald|lime|red|rose|yellow|amber|orange)-(?:50|100|200|300|400|500|600|700|800|900|950))(?:\/(\d{1,3}|\[[\d.]+\]))?`;
const used = new Set(), RE = new RegExp(String.raw`(?<![\w-])` + CORE + String.raw`(?![\w-])`, 'g'), ONE = new RegExp('^' + CORE + '$');
for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(RE)) used.add(m[0]);
const esc = s => s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
const PSEUDO = { 'hover:': ':hover', 'focus:': ':focus', 'focus-visible:': ':focus-visible', 'focus-within:': ':focus-within', 'active:': ':active', 'disabled:': ':disabled' };
const lines = [];
const SIDE = { 'border-t': ['border-top-color'], 'border-b': ['border-bottom-color'], 'border-l': ['border-left-color'], 'border-r': ['border-right-color'], 'border-x': ['border-left-color', 'border-right-color'], 'border-y': ['border-top-color', 'border-bottom-color'] };
for (const cls of [...used].sort()) {
  const m = ONE.exec(cls); if (!m) continue;
  const [, pre = '', util, color, op] = m;
  const role = util === 'text' || util === 'fill' || util === 'stroke' ? 'text' : util.startsWith('border') || util === 'ring' || util === 'divide' || util === 'accent' ? 'border' : 'bg';
  let hex = color === 'white' ? (role === 'text' ? WHITE_TEXT : WHITE_BG) : pick(...color.split('-'), role); if (!hex) continue;
  const alpha = op ? (op.startsWith('[') ? parseFloat(op.slice(1, -1)) : +op / 100) : null; const c = withAlpha(hex, alpha);
  let sel = '.' + esc(cls); if (pre === 'group-hover:') sel = '.group:hover ' + sel; else if (pre === 'placeholder:') sel += '::placeholder'; else if (PSEUDO[pre]) sel += PSEUDO[pre];
  if (util === 'divide') sel += ' > :not([hidden]) ~ :not([hidden])';
  const props = util === 'bg' ? ['background-color'] : util === 'text' ? ['color'] : util === 'ring' ? ['--tw-ring-color'] : util === 'fill' ? ['fill'] : util === 'stroke' ? ['stroke'] : util === 'accent' ? ['accent-color'] : SIDE[util] || ['border-color'];
  lines.push(`${T} ${sel}{${props.map(p => `${p}:${c} !important`).join(';')}}`);
}
// ── part 2: hard-coded colours in the app CSS ──
const SOURCES = ['src/app/globals.css', 'src/components/proxy-management/proxy-management.css', 'src/components/vm-management/vm-grid/vm-grid.css', 'src/components/dashboard/dashboard.css'];
const comp = [];
for (const rel of SOURCES) {
  const ast = postcss.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  ast.walkRules(rule => {
    if (rule.parent.type === 'atrule' && /^(keyframes|-webkit-keyframes)$/.test(rule.parent.name)) return;
    if (rule.parent.type === 'atrule' && rule.parent.name === 'media' && /print/.test(rule.parent.params)) return;
    if (rule.parent.type === 'atrule' && rule.parent.name === 'layer') return; // shadcn HSL variables: set by hand
    const sels = rule.selectors.filter(s => !s.includes('data-theme') && !/^(:root|html)\b/.test(s.trim()) || /^:root\s+::-webkit/.test(s.trim()));
    if (!sels.length) return;
    const decls = [];
    rule.each(d => { if (d.type !== 'decl' || d.prop.startsWith('--')) return; const v = recolor(d.value, d.prop); if (v) decls.push(`${d.prop}:${v}${d.important ? ' !important' : ''}`); });
    if (!decls.length) return;
    const scoped = sels.map(s => s.trim().startsWith(':root') ? s.replace(':root', T) : `${T} ${s.trim()}`).join(',');
    const css = `${scoped}{${decls.join(';')}}`;
    const media = rule.parent.type === 'atrule' && rule.parent.name === 'media' ? rule.parent.params : null;
    comp.push(media ? `@media ${media}{${css}}` : css);
  });
}
const head = `/* GENERATED by scripts/build-bronze-theme.cjs — do not edit by hand. Theme "Đồng ấm" (data-theme="bronze"). */\n`;
fs.writeFileSync(out, head + '/* 1. Tailwind colour utilities used in src */\n' + lines.join('\n') + '\n/* 2. Hard-coded colours of the app CSS */\n' + comp.join('\n') + '\n');
console.log(`utilities ${lines.length}, component rules ${comp.length} → ${path.relative(root, out)}`);
// Contrast report of the main pairs (for the evidence checklist).
const pairs = [['chữ chính / bề mặt', '#3A2A1C', CARD], ['chữ phụ token / bề mặt', '#7A6450', CARD], ['chữ phụ token / nền trang', '#7A6450', '#FAF6EF'], ['chữ phụ token / tiêu đề bảng', '#7A6450', '#F3E8D7'], ['chữ trên nút chính', WHITE_TEXT, '#8C5A2B'], ['nút chính khi rê', WHITE_TEXT, '#744820'], ['liên kết / điểm nhấn chữ', '#8C5A2B', CARD], ['olive 600 / bề mặt', P.olive['600'], CARD], ['hổ phách 700 / bề mặt', P.amber['700'], CARD], ['đỏ gạch 600 / bề mặt', P.brick['600'], CARD], ['chữ sidebar đang chọn', '#5E3A19', '#F3E4CF'], ['chữ sidebar', '#4E3B2A', '#F7EFE3']];
if (process.argv.includes('--contrast')) for (const [n, a, b] of pairs) console.log(`${n}: ${a} / ${b} = ${contrast(a, b).toFixed(2)}:1`);
