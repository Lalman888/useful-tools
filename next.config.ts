import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ExcelJS and Puppeteer are Node-only and must not be bundled for the browser.
  // katex and highlight.js stay bundled, but their stylesheets and font files
  // are read from node_modules at runtime, so keep node_modules deployed.
  serverExternalPackages: ["exceljs", "puppeteer-core", "@sparticuz/chromium"],
  // Read from disk at render time, so tracing cannot discover them on its own.
  outputFileTracingIncludes: {
    "/api/markdown/pdf": ["./assets/fonts/**"],
  },
};

export default nextConfig;
