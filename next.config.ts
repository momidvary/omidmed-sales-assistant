import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf.js reads bank statement PDFs on the server; it must stay a plain
  // Node package instead of being bundled.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
