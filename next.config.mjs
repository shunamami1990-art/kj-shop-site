/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { isServer }) {
    // node:sqlite 是 Node 内置模块，不让打包工具处理
    if (isServer) config.externals.push({ 'node:sqlite': 'commonjs node:sqlite' });
    return config;
  },
};

export default nextConfig;
