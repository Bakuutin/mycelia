import deno from "@deno/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export default defineConfig({
  plugins: [deno(), react()],
  resolve: {
    alias: {
      "@": "./src",
      // In docker builds we copy interfaces into /app/interfaces, but in local dev it's ../interfaces.
      "@interfaces/": (() => {
        const here = dirname(fileURLToPath(import.meta.url));
        const dockerLike = resolve(here, "interfaces");
        const monorepo = resolve(here, "..", "interfaces");
        const dir = fs.existsSync(dockerLike) ? dockerLike : monorepo;
        return `${dir}/`;
      })(),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "esnext",
  },
});
