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

  let logoPath = logoCandidates.find((p) => fs.existsSync(p));
  if (!logoPath) {
    throw new Error("Logo base não encontrado para geração de ícones.");
  }

  const image = await Jimp.read(logoPath);

  for (const size of [16, 48, 128]) {
    const clone = image.clone();
    clone.resize({ w: size, h: size });
    const outPath = path.join(iconsDir, `icon-${size}.png`);
    await clone.write(outPath);
    console.log(`✓ Ícone ${size}x${size} gerado em: ${outPath}`);
  }
}

generateIcons().catch((err) => {
  console.error("Erro ao gerar ícones:", err);
  process.exit(1);
});
