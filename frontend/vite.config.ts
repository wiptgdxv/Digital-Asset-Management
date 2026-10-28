import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [react()],
    build: {
      target: "chrome69",
      cssTarget: "chrome69",
    },
    server: {
      port: env.CHAT_TEST_PORT ? Number(env.CHAT_TEST_PORT) : 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: env.CHAT_TEST_BACKEND || "http://127.0.0.1:8888",
          ws: true,
        },
      },
    },
  };
});
