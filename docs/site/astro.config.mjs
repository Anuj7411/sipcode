import { defineConfig } from 'astro/config';

// https://astro.build/config
// No framework integrations needed — the page is pure Astro + vanilla TS.
// (Previously used @astrojs/react for the MascotVessel island. Ported to
// vanilla TS in src/components/MascotVessel.astro to drop ~135 KB of JS.)
export default defineConfig({
  // GitHub Pages project site: https://anuj7411.github.io/sipcode/
  // `base` makes internal asset paths resolve under /sipcode/.
  // Reference local assets via import.meta.env.BASE_URL (has trailing slash).
  site: 'https://anuj7411.github.io',
  base: '/sipcode',
});
