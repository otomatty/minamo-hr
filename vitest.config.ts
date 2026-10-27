import { defineConfig } from "vitest/config";

// 計算ロジック (src/shared) は純粋な TypeScript なので Node 環境でテストする。
// Worker を通すテスト (tests/setup.test.ts) は、wrangler の getPlatformProxy でローカルの D1 を使う
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
