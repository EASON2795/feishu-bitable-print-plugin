import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isChromeBuild = mode === 'chrome'

  return {
    base: './',
    publicDir: isChromeBuild ? 'chrome' : 'public',
    plugins: [react()],
    resolve: {
      alias: {
        '@runtime-host': fileURLToPath(
          new URL(isChromeBuild ? './src/chromeHost.ts' : './src/feishu.ts', import.meta.url),
        ),
      },
    },
    server: {
      allowedHosts: true,
    },
  }
})
