import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Libraries change far less often than our own code, so keeping them in
        // their own files lets browsers reuse the cached copy after each deploy.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@supabase")) return "supabase";
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|@remix-run|scheduler)[\\/]/.test(
              id,
            )
          ) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
});
