#!/usr/bin/env node
/**
 * Generates PWA icons into client/public/icons/.
 *
 * Usage:
 *   node scripts/generate-icons.mjs                     # "WC" placeholder monogram
 *   node scripts/generate-icons.mjs ./path/to/logo.png  # real logo (re-run once available)
 *
 * The optional source image is resized to fit inside the safe-zone for each
 * icon size and composited on a solid brand-blue background.
 *
 * Icons produced:
 *   icon-192.png          — 192×192  standard PWA icon  (purpose: any)
 *   icon-512.png          — 512×512  standard PWA icon  (purpose: any)
 *   icon-maskable-512.png — 512×512  logo within 80 % safe zone  (purpose: maskable)
 *   apple-touch-icon.png  — 180×180  iOS home-screen icon, opaque background
 *   favicon-32.png        — 32×32    browser-tab favicon
 */
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'icons');
mkdirSync(OUT_DIR, { recursive: true });

const BRAND = { r: 0x50, g: 0x96, b: 0xcf, alpha: 255 };
const BRAND_HEX = '#5096cf';

// ---------------------------------------------------------------------------
// Placeholder SVG: bold "WC" centred on a brand-blue square.
// fontSize should already be scaled to the desired safe-zone fraction.
// ---------------------------------------------------------------------------
function wcSvg(size, fontSize) {
  const half = size / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" fill="${BRAND_HEX}"/>` +
      `<text x="${half}" y="${half}" ` +
      `font-family="Arial, Helvetica, sans-serif" ` +
      `font-size="${fontSize}" font-weight="bold" ` +
      `fill="white" text-anchor="middle" dominant-baseline="central"` +
      `>WC</text>` +
    `</svg>`,
  );
}

// ---------------------------------------------------------------------------
// Generate one icon.
//
// safeZone: the fraction of `size` that is the "safe" content area.
//   1.0 = content can fill the whole icon (standard icons)
//   0.8 = content must fit inside the central 80 % (maskable icons)
// ---------------------------------------------------------------------------
async function generate({ size, outName, source, safeZone = 1.0 }) {
  const out = join(OUT_DIR, outName);

  if (source) {
    // Real logo path: resize logo to fit inside the safe area, composite on
    // a solid brand-blue background so there is never bare transparency.
    const inner = Math.round(size * safeZone);
    const pad   = Math.round((size - inner) / 2);

    const logoBuffer = await sharp(source)
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .png()
      .toBuffer();

    await sharp({ create: { width: size, height: size, channels: 4, background: BRAND } })
      .composite([{ input: logoBuffer, top: pad, left: pad }])
      .png()
      .toFile(out);
  } else {
    // Placeholder: font-size fills ~42 % of the safe-zone edge length.
    const fontSize = Math.round(size * safeZone * 0.42);
    await sharp(wcSvg(size, fontSize)).png().toFile(out);
  }

  const kb = ((await sharp(out).metadata()).size ?? 0) / 1024;
  console.log(`  ✓  ${outName.padEnd(26)} ${size}×${size}  ${kb.toFixed(1)} KB`);
}

// ---------------------------------------------------------------------------
async function main() {
  const source = process.argv[2] ?? null;
  console.log(`\nGenerating icons → ${OUT_DIR}`);
  console.log(source ? `  source : ${source}` : '  source : "WC" placeholder\n');

  await generate({ size: 192, outName: 'icon-192.png',          source });
  await generate({ size: 512, outName: 'icon-512.png',          source });
  await generate({ size: 512, outName: 'icon-maskable-512.png', source, safeZone: 0.8 });
  await generate({ size: 180, outName: 'apple-touch-icon.png',  source });
  await generate({ size: 32,  outName: 'favicon-32.png',        source });

  console.log('\nDone. Re-run with a logo path once the real asset is available:');
  console.log('  npm run generate-icons -- ./path/to/logo.png\n');
}

main().catch(err => { console.error(err); process.exit(1); });
