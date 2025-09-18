import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { PNG } from "pngjs";

const sizes = [192, 512];
const background = [0x1e, 0x88, 0xe5];
const white = [0xff, 0xff, 0xff];
const outputDir = resolve("public", "icons");

mkdirSync(outputDir, { recursive: true });

for (const size of sizes) {
  const png = new PNG({ width: size, height: size });
  fillBackground(png, background);
  drawRing(png, size, white);
  drawText(png, size, white);
  const buffer = PNG.sync.write(png, { colorType: 6 });
  const fileName = `icon-${size}.png`;
  writeFileSync(resolve(outputDir, fileName), buffer);
  console.log(`Generated ${fileName}`);
}

function fillBackground(png, color) {
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      setPixel(png, x, y, color);
    }
  }
}

function drawRing(png, size, color) {
  const center = (size - 1) / 2;
  const margin = size * 0.08;
  const outerRadius = size / 2 - margin;
  const thickness = size * 0.06;
  const innerRadius = outerRadius - thickness;
  const outerSq = outerRadius * outerRadius;
  const innerSq = innerRadius * innerRadius;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= outerSq && distanceSq >= innerSq) {
        setPixel(png, x, y, color);
      }
    }
  }
}

function drawText(png, size, color) {
  const centerX = (size - 1) / 2;
  const textWidth = size * 0.6;
  const textHeight = size * 0.36;
  const stroke = Math.max(1, Math.round(size * 0.06));
  const letterWidth = Math.round(textWidth / 4);
  const gap = Math.round(size * 0.02);
  let cursor = Math.round(centerX - textWidth / 2);
  const top = Math.round((size - textHeight) / 2);

  drawH(cursor, top, letterWidth, textHeight, stroke, color, png);
  cursor += letterWidth + gap;
  drawI(cursor, top, letterWidth, textHeight, stroke, color, png);
  cursor += letterWidth + gap;
  drawI(cursor, top, letterWidth, textHeight, stroke, color, png);
  cursor += letterWidth + gap;
  drawT(cursor, top, letterWidth, textHeight, stroke, color, png);
}

function drawH(x, y, width, height, stroke, color, png) {
  drawRect(png, x, y, stroke, height, color);
  drawRect(png, x + width - stroke, y, stroke, height, color);
  drawRect(png, x, y + Math.round(height / 2) - Math.floor(stroke / 2), width, stroke, color);
}

function drawI(x, y, width, height, stroke, color, png) {
  const barX = x + Math.round(width / 2) - Math.floor(stroke / 2);
  drawRect(png, barX, y, stroke, height, color);
}

function drawT(x, y, width, height, stroke, color, png) {
  drawRect(png, x, y, width, stroke, color);
  const barX = x + Math.round(width / 2) - Math.floor(stroke / 2);
  drawRect(png, barX, y, stroke, height, color);
}

function drawRect(png, x, y, width, height, color) {
  const maxX = Math.min(png.width, x + width);
  const maxY = Math.min(png.height, y + height);
  for (let yy = Math.max(0, y); yy < maxY; yy += 1) {
    for (let xx = Math.max(0, x); xx < maxX; xx += 1) {
      setPixel(png, xx, yy, color);
    }
  }
}

function setPixel(png, x, y, color) {
  const idx = (png.width * y + x) << 2;
  png.data[idx] = color[0];
  png.data[idx + 1] = color[1];
  png.data[idx + 2] = color[2];
  png.data[idx + 3] = 0xff;
}
