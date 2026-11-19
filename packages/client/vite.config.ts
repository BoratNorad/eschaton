import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Content lives in /data at the repo root; the worker imports it at build time.
  server: { fs: { allow: ["../.."] } },
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
});
