import fs from "node:fs";
import path from "node:path";
import { Jimp } from "jimp";

async function generateIcons() {
  const rootDir = process.cwd();
  const iconsDir = path.resolve(rootDir, "public/icons");
  fs.mkdirSync(iconsDir, { recursive: true });

  const logoCandidates = [
    path.resolve(rootDir, "../yadp/media/logo.png"),
    path.resolve(rootDir, "../../yadp/media/logo.png"),
  ];

  const logoPath = logoCandidates.find((p) => fs.existsSync(p));
  if (!logoPath) {
    throw new Error("Logo base não encontrado para geração de ícones.");
  }

  const baseLogo = await Jimp.read(logoPath);

  // 1. Detectar bounding box real da arte (descartando as bordas transparentes vazias)
  let minX = baseLogo.bitmap.width;
  let maxX = 0;
  let minY = baseLogo.bitmap.height;
  let maxY = 0;

  for (let y = 0; y < baseLogo.bitmap.height; y++) {
    for (let x = 0; x < baseLogo.bitmap.width; x++) {
      const idx = (y * baseLogo.bitmap.width + x) * 4;
      const alpha = baseLogo.bitmap.data[idx + 3];
      if (alpha > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const squareDim = Math.max(cropW, cropH);

  // Adiciona margem de segurança de ~4% para os nós não colarem no limite do canvas
  const padding = Math.round(squareDim * 0.04);
  const masterSize = squareDim + padding * 2;

  const master = new Jimp({ width: masterSize, height: masterSize, color: 0x00000000 });
  const rawCropped = baseLogo.clone().crop({ x: minX, y: minY, w: cropW, h: cropH });
  master.composite(
    rawCropped,
    padding + Math.floor((squareDim - cropW) / 2),
    padding + Math.floor((squareDim - cropH) / 2),
  );

  // 2. Opção A: Ciano Sentinela de Alto Contraste
  // Transforma áreas escuras (que somem na barra escura) em ciano vibrante legível
  for (let y = 0; y < masterSize; y++) {
    for (let x = 0; x < masterSize; x++) {
      const idx = (y * masterSize + x) * 4;
      const alpha = master.bitmap.data[idx + 3];
      if (alpha > 20) {
        const r = master.bitmap.data[idx];
        const g = master.bitmap.data[idx + 1];
        const b = master.bitmap.data[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        if (lum < 50) {
          // Corpo dos nós e do hub: ciano azulado vibrante (#0e7490 / #0891b2)
          master.bitmap.data[idx] = 14;
          master.bitmap.data[idx + 1] = 116;
          master.bitmap.data[idx + 2] = 144;
          master.bitmap.data[idx + 3] = Math.min(255, alpha + 30);
        } else if (lum >= 50 && lum < 140) {
          // Detalhes intermediários: ciano elétrico (#06b6d4)
          master.bitmap.data[idx] = 6;
          master.bitmap.data[idx + 1] = 182;
          master.bitmap.data[idx + 2] = 212;
        }
        // Destaques brilhantes (lum >= 140) mantidos originais (ciano claro / branco)
      }
    }
  }

  // 3. Gerar ícones nas resoluções necessárias (16, 32, 48, 128)
  for (const size of [16, 32, 48, 128]) {
    const icon = master.clone().resize({ w: size, h: size });
    const outPath = path.join(iconsDir, `icon-${size}.png`);
    await icon.write(outPath);
    console.log(`✓ Ícone ${size}x${size} gerado em: ${outPath}`);
  }
}

generateIcons().catch((err) => {
  console.error("Erro ao gerar ícones:", err);
  process.exit(1);
});
