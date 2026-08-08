import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Component rendering and the demo client both need DOM globals.
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
