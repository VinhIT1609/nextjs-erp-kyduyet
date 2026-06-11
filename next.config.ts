import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    // Ép Next.js nạp oracledb trực tiếp từ node_modules bên ngoài môi trường, KHÔNG đóng gói cụm
    serverComponentsExternalPackages: ['oracledb'],
  },
};
export default nextConfig;
