import { fileURLToPath } from 'node:url';

// The standalone gallery has native hash links, not a Next router/provider.
const galleryConfig = {
  publicDir: fileURLToPath(new URL('../../apps/web/public', import.meta.url)),
  resolve: {
    alias: [
      {
        find: /^next\/link$/,
        replacement: fileURLToPath(new URL('./link.tsx', import.meta.url)),
      },
      {
        find: /^next\/navigation$/,
        replacement: fileURLToPath(new URL('./navigation.ts', import.meta.url)),
      },
    ],
  },
};

export default galleryConfig;
