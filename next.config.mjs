import { createRequire } from 'module';
import { imageHosts } from './image-hosts.config.mjs';

const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.DIST_DIR || '.next',
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  env: {
    // Forward the server-side MAPBOX_ACCESS_TOKEN to the client bundle.
    // IMPORTANT: On Vercel you must ALSO add NEXT_PUBLIC_MAPBOX_TOKEN as a
    // separate environment variable (same value as MAPBOX_ACCESS_TOKEN) so
    // that Next.js can inline it into the client bundle at build time.
    // The env block below acts as a fallback for local development.
    NEXT_PUBLIC_MAPBOX_TOKEN:
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      process.env.MAPBOX_ACCESS_TOKEN ||
      '',
  },
  images: {
    remotePatterns: imageHosts,
    minimumCacheTTL: 60,
    qualities: [75, 85, 100],
  },
  webpack(
    config,
    {
      dev: dev
    }
  ) {
    if (dev) {
      // Optional: only wired up if this package is actually installed (a
      // leftover dev-tooling hook from the original scaffold, unrelated to
      // the app itself). Without this guard, `next dev` 500s on every
      // request whenever the package isn't present in node_modules.
      let componentTaggerAvailable = false;
      try {
        require.resolve('@dhiwise/component-tagger/nextLoader');
        componentTaggerAvailable = true;
      } catch {
        // Not installed — skip the loader entirely.
      }
      if (componentTaggerAvailable) {
        config.module.rules.push({
          test: /\.(jsx|tsx)$/,
          exclude: [/node_modules/],
          use: [{
            loader: '@dhiwise/component-tagger/nextLoader',
          }],
        });
      }
      const ignoredPaths = (process.env.WATCH_IGNORED_PATHS || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      config.watchOptions = {
        ignored: ignoredPaths.length
          ? ignoredPaths.map((p) => `**/${p.replace(/^\/+|\/+$/g, '')}/**`)
          : undefined,
      };
    }
    return config;
  },
};
export default nextConfig;