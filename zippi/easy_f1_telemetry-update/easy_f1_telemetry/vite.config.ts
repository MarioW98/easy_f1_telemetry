import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Su GitHub Pages il sito vive sotto /<nome-repo>/.
// In CI si usa `vite build --base=/<nome-repo>/`; in locale resta "/".
export default defineConfig({
  base: process.env["VITE_BASE_PATH"] || "/",
  plugins: [tsConfigPaths(), tanstackRouter(), viteReact(), tailwindcss()],
});
