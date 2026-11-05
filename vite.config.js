import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'html-csp-prod-only',
      apply: 'build',
      transformIndexHtml(html) {
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self';" />`;
        return html.replace('<head>', `<head>\n    ${csp}`);
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
});
