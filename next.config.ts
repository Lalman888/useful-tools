import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ExcelJS and Puppeteer are Node-only and must not be bundled for the browser.
  // katex and highlight.js stay bundled, but their stylesheets and font files
  // are read from node_modules at runtime, so keep node_modules deployed.
  serverExternalPackages: ["exceljs", "puppeteer-core", "@sparticuz/chromium"],
  // Read from disk at render time, so tracing cannot discover them on its own.
  outputFileTracingIncludes: {
    "/api/markdown/pdf": ["./assets/fonts/**"],
    // The link-preview card is drawn with the same bundled faces.
    "/opengraph-image": ["./assets/fonts/**"],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Uploaded files are served with an explicit type; never let a
          // browser guess a different, executable one.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // A share link is a secret. Sending it in the Referer header to
          // whatever a document links out to would leak it.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
