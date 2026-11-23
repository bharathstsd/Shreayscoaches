import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "apple-touch-icon.png"],
      manifest: {
        name: "Shreyas Coupons",
        short_name: "Coupons",
        description: "Coupon & referral tracking for Shreyas Wellness World clubs",
        theme_color: "#0F3B32",
        background_color: "#F6F3EC",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/django-admin\//, /^\/static\//, /\.(xlsx|csv|pdf)(\?.*)?$/],
        runtimeCaching: [],   // API calls always go to the server (no stale coupon data)
      },
    }),
  ],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
