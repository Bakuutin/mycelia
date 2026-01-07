import deno from "@deno/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { existsSync } from "node:fs";

// In Docker build, interfaces is copied to ./interfaces
// In local dev, interfaces is at ../interfaces
const interfacesPath = existsSync("../interfaces") ? "../interfaces/" : "./interfaces/";

export default defineConfig({
  plugins: [deno(), react()],
  resolve: {
    alias: {
      "@": "./src",
      "@interfaces/": interfacesPath,
    },
  },
  server: {
    watch: {
      // Use polling for Docker volumes (native fs events don't work reliably)
      usePolling: true,
      interval: 1000,
    },
    hmr: {
      // Ensure HMR works through Docker port mapping
      host: "localhost",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "esnext",
  },
});
