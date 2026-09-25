/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Parallel dev servers (one per lane) must not share a build directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // Scanned T3 sheets, grant letters, BEOs and session photos arrive as
    // server-action FormData; the 1 MB default refuses a phone photo.
    serverActions: { bodySizeLimit: "25mb" },
    // Server-only packages: the pg driver and the headless Univer formula
    // engine run in the Node runtime and must not be bundled into the client.
    serverComponentsExternalPackages: [
      "pg",
      "@univerjs/core",
      "@univerjs/engine-formula",
      "@univerjs/sheets",
      "@univerjs/sheets-formula",
      "pdf-lib",
      "qrcode",
      "jszip",
      "exifr",
      "nodemailer",
    ],
  },
};

export default nextConfig;
