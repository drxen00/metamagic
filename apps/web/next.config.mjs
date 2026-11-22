/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // MetaMagic never uses next/image; turning the optimizer off removes the
  // /_next/image endpoint as an attack surface entirely.
  images: { unoptimized: true },
  transpilePackages: ["@metamagic/shared"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://127.0.0.1:3801"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
