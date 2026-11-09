import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Run from the repository root (npm scripts do). Output is the wrangler assets directory.
// ui/public/.gitkeep is copied into outDir so the tracked ui-dist/.gitkeep survives the wipe.
export default defineConfig({
  root: "ui",
  plugins: [react()],
  build: { outDir: "../ui-dist", emptyOutDir: true },
});
