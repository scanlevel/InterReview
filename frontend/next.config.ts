import type { NextConfig } from "next";

const backendOrigin = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.88"],
  experimental: {
    // 자소서 분석(LLM)은 30초를 넘길 수 있어 기본 프록시 타임아웃(30s)으로는 끊긴다.
    proxyTimeout: 180_000,
  },
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
