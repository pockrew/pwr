import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  base: "/admin/",
  plugins: [
    tailwindcss(),
    solid(),
    {
      name: "serve-root-favicon",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === "/favicon.ico") {
            req.url = "/admin/favicon.ico";
          }
          next();
        });
      },
    },
  ],
  resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 15175,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:18787",
        changeOrigin: false,
      },
      // Ingress URLs copied in development point at this origin; forward them to the server.
      "/ingress": {
        target: "http://localhost:18787",
        changeOrigin: false,
      },
    },
  },
});
