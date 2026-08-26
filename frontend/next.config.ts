import type { NextConfig } from "next";

const backendOrigin = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.88"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: backendOrigin + "/:path*",
      },
    ];
  },
};

export default nextConfig;
