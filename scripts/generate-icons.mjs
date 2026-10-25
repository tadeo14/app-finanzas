// Genera los PNG de la app a partir de los SVG de public/. Se corre a mano cuando cambia el diseño del ícono:
//   npx playwright install chromium   (una sola vez)
//   node scripts/generate-icons.mjs
// Usa Playwright (no es dependencia del proyecto) solo para rasterizar.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const svg = (name) => readFileSync(pub(name), 'utf8');

// [archivo de salida, svg de origen, tamaño, fondo transparente]
const targets = [
  ['icon-192.png', 'icon.svg', 192, true],
  ['icon-512.png', 'icon.svg', 512, true],
  ['icon-maskable-512.png', 'icon-maskable.svg', 512, false],
  // iOS no admite transparencia ni SVG en el ícono de la pantalla de inicio: cuadrado a sangre.
  ['apple-touch-icon.png', 'icon-maskable.svg', 180, false],
  ['favicon-32.png', 'icon.svg', 32, true],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [out, source, size, transparent] of targets) {
  await page.setViewportSize({ width: size, height: size });
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg(source)).toString('base64')}`;
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${dataUrl}">`);
  await page.screenshot({ path: pub(out), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('✓', out);
}
await browser.close();
