import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow HMR when the dev server is opened from the LAN address.
  allowedDevOrigins: ["192.168.0.88"],
};

export default nextConfig;
