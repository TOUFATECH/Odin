// Vite construit l'interface (barre de côté, barre du haut, menus, pages pegase://) dans dist/ui.
import { defineConfig } from 'vite';
export default defineConfig({
  root: 'src/ui',
  base: './',
  build: { outDir: '../../dist/ui', emptyOutDir: true, target: 'chrome140', assetsInlineLimit: 0, sourcemap: false },
});
