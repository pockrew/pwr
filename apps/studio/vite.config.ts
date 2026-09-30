import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Vite owns development HTML/HMR; local APIs use the configured agent listener.
const agentTarget = `http://127.0.0.1:${process.env["PWR_AGENT_PORT"] ?? 18788}`;

// The agent API requires its local token; the dev proxy reads it from the agent's data dir so the
// browser never has to hold it.
const agentTokenFile = join(
  dirname(process.env["AGENT_DB_FILE_NAME"] ?? join(homedir(), ".pockrew", "agent.db")),
  "agent.token",
);
const agentToken = (): string | undefined =>
  existsSync(agentTokenFile) ? readFileSync(agentTokenFile, "utf8").trim() : undefined;

export default defineConfig({
  base: "/",
  // Release builds pass PWR_VERSION; dev shows the shared fallback.
  define: process.env["PWR_VERSION"]
    ? { __PWR_VERSION__: JSON.stringify(process.env["PWR_VERSION"]) }
    : {},
  plugins: [tailwindcss(), solid()],
  resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 15174,
    strictPort: true,
    proxy: {
      "/api": {
        target: agentTarget,
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (request) => {
            const token = agentToken();
            if (token) request.setHeader("authorization", `Bearer ${token}`);
          });
        },
      },
    },
  },
});
