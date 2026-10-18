import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import {
  BRAND_BLADES as BLADES,
  BRAND_SMALL_MARK_SCALE,
  BRAND_TILE_RADIUS as TILE_RADIUS,
  BRAND_TILE_STOPS as TILE_STOPS,
} from "../src/components/shared/brand-geometry";

type IconOptions = {
  // Rounded tile with transparent corners, or a full-bleed square the OS masks.
  rounded: boolean;
  // Share of the tile the mark's 100-unit grid occupies.
  markScale: number;
  // Edge highlight and blade shadow; they only read at app-icon sizes.
  lighting: boolean;
};

function iconSvg({ rounded, markScale, lighting }: IconOptions) {
  const radius = rounded ? TILE_RADIUS : 0;
  const tile = `<rect width="100" height="100" rx="${radius}"/>`;
  const offset = (100 - 100 * markScale) / 2;
  const stops = TILE_STOPS.map(
    ([at, color]) => `<stop offset="${at}" stop-color="${color}"/>`,
  ).join("");
  const blades = BLADES.map((d) => `<path d="${d}"/>`).join("");
  const lightingDefs = lighting
    ? `<mask id="top-edge"><rect width="100" height="100" fill="#fff"/><rect y="0.6" width="100" height="100" rx="${radius}" fill="#000"/></mask>
<filter id="blade-shadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="0.6" stdDeviation="0.45" flood-color="#000" flood-opacity="0.2"/></filter>`
    : "";
  const highlight = lighting
    ? `<g mask="url(#top-edge)" fill="#fff" fill-opacity="0.3">${tile}</g>
<rect x="0.25" y="0.25" width="99.5" height="99.5" rx="${Math.max(radius - 0.25, 0)}" fill="none" stroke="#fff" stroke-opacity="0.06" stroke-width="0.5"/>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>${lightingDefs}</defs>
<g fill="url(#tile)">${tile}</g>
${highlight}
<g fill="#fff"${lighting ? ' filter="url(#blade-shadow)"' : ""} transform="translate(${offset} ${offset}) scale(${markScale})">${blades}</g>
</svg>
`;
}

function png(svg: string, size: number) {
  return sharp(Buffer.from(svg), { density: 72 * (size / 100) * 4 })
    .resize(size, size)
    .png()
    .toBuffer();
}

// ICO container holding PNG frames, which every current browser accepts.
function ico(frames: { size: number; data: Buffer }[]) {
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...frames.map(({ data }) => data)]);
}

const favicon = iconSvg({
  rounded: true,
  markScale: BRAND_SMALL_MARK_SCALE,
  lighting: false,
});
const appIcon = iconSvg({ rounded: true, markScale: 0.635, lighting: true });
const fullBleed = iconSvg({ rounded: false, markScale: 0.635, lighting: true });
// Maskable icons keep the mark inside the central 80% safe zone.
const maskable = iconSvg({ rounded: false, markScale: 0.55, lighting: true });

const root = resolve(import.meta.dirname, "..");
const outputs: [string, Promise<Buffer> | string][] = [
  ["src/app/icon.svg", favicon],
  [
    "src/app/favicon.ico",
    Promise.all(
      [16, 32, 48].map(async (size) => ({
        size,
        data: await png(favicon, size),
      })),
    ).then(ico),
  ],
  ["src/app/apple-icon.png", png(fullBleed, 180)],
  ["public/icons/icon-192.png", png(appIcon, 192)],
  ["public/icons/icon-512.png", png(appIcon, 512)],
  ["public/icons/icon-maskable-512.png", png(maskable, 512)],
];

for (const [path, content] of outputs) {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await content);
  console.log(`wrote ${path}`);
}
