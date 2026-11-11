import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { webDevGateway } from "./src/development/webDevGateway";

const moduleRoot = resolve(homedir(), "Desktop/PinK-Test");

export default defineConfig({
  resolve: {
    alias: {
      "@pink-build": resolve(moduleRoot, "tools/build-ui/src"),
      "@pink-data": resolve(moduleRoot, "tools/case-catalog"),
      "@pink-delivery": resolve(
        moduleRoot,
        "results/2026-10-26-backend-delivery-1793005004391",
      ),
      "@editor-description": resolve(
        import.meta.dirname,
        "../outputs/case-editor-contract-draft",
      ),
    },
  },
  plugins: [
    react(),
    webDevGateway(),
    {
      name: "local-development-csp",
      transformIndexHtml(html, context) {
        // Vite refresh preamble and injected CSS are local-development only.
        return context.server
          ? html
              .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
              .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
          : html;
      },
    },
  ],
  base: "./",
  server: {
    host: "127.0.0.1",
    strictPort: true,
    port: 5187,
    fs: {
      allow: [
        import.meta.dirname,
        resolve(import.meta.dirname, "../outputs/case-editor-contract-draft"),
        resolve(moduleRoot, "tools/build-ui/src"),
        resolve(moduleRoot, "tools/case-catalog"),
        resolve(
          moduleRoot,
          "results/2026-10-26-backend-delivery-1793005004391",
        ),
      ],
    },
  },
  build: { outDir: "dist" },
});
