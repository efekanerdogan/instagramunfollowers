// tool.js dosyasını index.html'e gömer:
//   #tool-src  → okunabilir kaynak (konsol kodu ve demo için)
//   #tool-min  → terser ile küçültülmüş sürüm (yer imi bağlantısı için)
// Kullanım: npm install && npm run build
import { readFileSync, writeFileSync } from 'node:fs';

const tool = readFileSync(new URL('./tool.js', import.meta.url), 'utf8').trim();

let min = '';
try {
  const { minify } = await import('terser');
  const out = await minify(tool, { ecma: 2020, compress: { passes: 2 }, mangle: true, format: { comments: false } });
  min = out.code;
} catch (e) {
  console.warn('⚠ terser bulunamadı ya da hata verdi; yer imi küçültülmeden üretilecek. (npm install)\n ', e.message);
}

for (const [name, code] of [['tool.js', tool], ['küçültülmüş kod', min]]) {
  if (/<\/script|<!--/i.test(code)) throw new Error(`${name} "</script" veya "<!--" içeremez.`);
}

const file = new URL('./index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
const re = /(<!-- TOOL:START -->\r?\n)[\s\S]*?(\r?\n<!-- TOOL:END -->)/;
if (!re.test(html)) throw new Error('index.html içinde TOOL işaretleri bulunamadı.');

const block =
  `<script type="text/plain" id="tool-src">\n${tool}\n</script>\n` +
  `<script type="text/plain" id="tool-min">${min}</script>`;
writeFileSync(file, html.replace(re, (_, a, b) => a + block + b));

const bm = 'javascript:' + (min || tool).replace(/%/g, '%25').replace(/\r?\n/g, '%0A').replace(/#/g, '%23');
const urlLen = new URL(bm).href.length;
console.log(`✓ index.html güncellendi — kaynak ${(tool.length / 1024).toFixed(1)} KB, yer imi ${(urlLen / 1024).toFixed(1)} KB`);
if (urlLen > 60000) console.warn('⚠ Yer imi 60 KB üzerinde; Firefox 64 KB üzerini kaydetmez.');
