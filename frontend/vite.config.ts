import deno from "@deno/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { existsSync } from "node:fs";

// In Docker build, myceliasdk is copied to ./myceliasdk
// In local dev, myceliasdk is at ../myceliasdk
const interfacesPath = existsSync("../myceliasdk")
  ? "../myceliasdk/"
  : "./myceliasdk/";

export default defineConfig({
  plugins: [
    deno(),
    react(),
    {
      name: "mycelia-readiness-log",
      configureServer(server) {
        server.httpServer?.once("listening", () => {
          const address = server.httpServer?.address();
          const host = typeof address === "object" && address
            ? address.address
            : "0.0.0.0";
          const port = typeof address === "object" && address
            ? address.port
            : server.config.server.port;
          console.info(
            `[READY] frontend ready mode=development hmr=enabled source=bind-mount url=http://${host}:${port} readyAt=${
              new Date().toISOString()
            }`,
          );
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": "./src",
      "@myceliasdk/": interfacesPath,
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
