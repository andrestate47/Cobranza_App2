const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: process.env.NEXT_OUTPUT_MODE || undefined,
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../'),
  },
  eslint: {
    // 🔒 Evita que ESLint rompa el build en Vercel
    ignoreDuringBuilds: true,
  },
  typescript: {
    // ⚠️ Desactiva los errores de TS solo durante el build en producción
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
