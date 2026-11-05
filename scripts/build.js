import fs from "node:fs";
import path from "node:path";
import { build } from "vite";

const rootDir = process.cwd();
const distDir = path.resolve(rootDir, "dist");

async function runBuild() {
  console.log("Iniciando build do YAPS Extension (MV3)...");

  // 1. Limpa dist/
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  // 2. Build do Popup UI (HTML + Assets)
  console.log("-> Compilando Popup UI...");
  await build({
    root: path.resolve(rootDir, "src/popup"),
    base: "./",
    build: {
      outDir: path.resolve(distDir, "popup"),
      emptyOutDir: false,
      rollupOptions: {
        input: path.resolve(rootDir, "src/popup/index.html"),
      },
    },
  });

  // 3. Build do Background Service Worker (ES module)
  console.log("-> Compilando Background Service Worker...");
  await build({
    build: {
      outDir: distDir,
      emptyOutDir: false,
      lib: {
        entry: path.resolve(rootDir, "src/background/index.ts"),
        name: "YapsBackground",
        formats: ["es"],
        fileName: () => "background.js",
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  // 4. Build do Content Script Isolado (IIFE auto-contido)
  console.log("-> Compilando Content Script Isolado...");
  await build({
    build: {
      outDir: distDir,
      emptyOutDir: false,
      lib: {
        entry: path.resolve(rootDir, "src/content/isolated.ts"),
        name: "YapsContentIsolated",
        formats: ["iife"],
        fileName: () => "content-isolated.js",
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  // 5. Build do Main World Injector (IIFE auto-contido)
  console.log("-> Compilando Main World Injector...");
  await build({
    build: {
      outDir: distDir,
      emptyOutDir: false,
      lib: {
        entry: path.resolve(rootDir, "src/content/main-injector.ts"),
        name: "YapsContentMain",
        formats: ["iife"],
        fileName: () => "content-main.js",
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  // 6. Copia manifest.json e icons
  console.log("-> Copiando manifest.json e ícones...");
  fs.copyFileSync(
    path.resolve(rootDir, "src/manifest.json"),
    path.resolve(distDir, "manifest.json"),
  );

  const publicIconsDir = path.resolve(rootDir, "public/icons");
  const distIconsDir = path.resolve(distDir, "icons");
  if (fs.existsSync(publicIconsDir)) {
    fs.mkdirSync(distIconsDir, { recursive: true });
    for (const file of fs.readdirSync(publicIconsDir)) {
      fs.copyFileSync(path.join(publicIconsDir, file), path.join(distIconsDir, file));
    }
  }

  console.log("✓ Build finalizado com sucesso em dist/!");
}

runBuild().catch((err) => {
  console.error("Erro no build:", err);
  process.exit(1);
});
