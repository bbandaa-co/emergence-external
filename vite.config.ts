import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works whether it's served from the domain root
// (custom domain / user page) or a project-page subpath like
// https://<user>.github.io/<repo>/. Combined with the single-page, router-free
// app, this avoids the usual GitHub Pages asset/routing 404s.
export default defineConfig({
  base: './',
  plugins: [react()],
});
