// vite.config.js
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function validateProductionApiUrl(apiUrl) {
  if (!apiUrl) {
    throw new Error(
      'VITE_API_URL is required for production builds. Set it in .env.production or the CI/CD environment.',
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(apiUrl);
  } catch {
    throw new Error('VITE_API_URL must be a valid absolute URL for production builds.');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('VITE_API_URL must use https:// for production builds.');
  }

  const hostname = String(parsedUrl.hostname || '').trim().toLowerCase();
  if (!hostname || ['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error(
      'VITE_API_URL cannot point to localhost for production builds. Use the real production API origin.',
    );
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = normalizeBaseUrl(env.VITE_API_URL);

  if (command === 'build' && mode === 'production') {
    validateProductionApiUrl(apiUrl);
  }

  return {
    base: '/',
    plugins: [react()],
    server: {
      port: 5173,
      open: false,
    },
  };
});
