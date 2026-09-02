import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages はリポジトリ名のサブパスで配信されるが、Vercel はルート配信。
// Pages 用のビルドだけ GITHUB_PAGES=true を立てて base を切り替える
const base = process.env.GITHUB_PAGES === "true" ? "/se_composer/" : "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 3000, open: true },
  build: { outDir: "dist" },
});
