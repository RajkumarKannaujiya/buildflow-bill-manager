import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit"],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
};

export default nextConfig;
