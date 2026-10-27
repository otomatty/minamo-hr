import { defineConfig } from "vitest/config";

// 計算ロジック (src/shared) は純粋な TypeScript なので Node 環境でテストする
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
