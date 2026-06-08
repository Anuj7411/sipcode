import { defineConfig } from 'astro/config';

// https://astro.build/config
// No framework integrations needed — the page is pure Astro + vanilla TS.
// (Previously used @astrojs/react for the MascotVessel island. Ported to
// vanilla TS in src/components/MascotVessel.astro to drop ~135 KB of JS.)
export default defineConfig({
  // GitHub Pages target: Anuj7411.github.io/sipcode
  // We keep site config flexible so dev works without a base path
  // and prod can set `base: '/sipcode'` later when we deploy.
});
