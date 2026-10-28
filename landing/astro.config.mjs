import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vue from '@astrojs/vue';

export default defineConfig({
  site: 'https://portal.elroundnet.my.id',
  outDir: '../public/landing',
  devToolbar: { enabled: false },
  integrations: [vue()],
  vite: { plugins: [tailwindcss()] },
});
