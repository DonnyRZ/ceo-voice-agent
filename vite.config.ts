import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const workspace = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("frontend/", import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [workspace] },
    proxy: {
      "/api": `http://127.0.0.1:${process.env.API_PORT || 3000}`,
    },
  },
});
