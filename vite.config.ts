import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// PX01 security tests import the real Deno edge-function entrypoints
// (video-worker / video-intake) under vitest. Those modules use Deno-style
// `npm:` specifiers; this plugin resolves them for the Node test runtime.
// `@supabase/supabase-js` maps to the installed package; the Google AI server
// SDK is replaced with an instrumented stub so tests can assert that zero
// provider calls happen on denied requests. It only matches those exact
// specifiers and never affects src/ or the production build.
const GOOGLE_AI_SERVER_STUB_ID = '\0deno-npm-stub:@google/generative-ai/server';
const GOOGLE_AI_SERVER_STUB = `
const state = (globalThis.__px01GoogleAiServerStub ??= {
  constructions: 0,
  getFileCalls: 0,
  uploadFileCalls: 0,
});
export class GoogleAIFileManager {
  constructor(_apiKey) {
    state.constructions += 1;
  }
  async getFile(_name) {
    state.getFileCalls += 1;
    throw new Error('GoogleAIFileManager.getFile: unexpected provider call in test');
  }
  async uploadFile(_path, _options) {
    state.uploadFileCalls += 1;
    throw new Error('GoogleAIFileManager.uploadFile: unexpected provider call in test');
  }
}
export const FileState = { PROCESSING: 'PROCESSING', ACTIVE: 'ACTIVE', FAILED: 'FAILED' };
`;

const denoNpmStubs: Plugin = {
  name: 'deno-npm-stubs',
  enforce: 'pre',
  resolveId(source) {
    if (source === 'npm:@supabase/supabase-js@2') {
      return this.resolve('@supabase/supabase-js', undefined, { skipSelf: true });
    }
    if (source === 'npm:@google/generative-ai/server') {
      return GOOGLE_AI_SERVER_STUB_ID;
    }
    return null;
  },
  load(id) {
    if (id === GOOGLE_AI_SERVER_STUB_ID) {
      return GOOGLE_AI_SERVER_STUB;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [react(), denoNpmStubs],
  test: {
    environment: 'jsdom',
    globals: true,
  },
  
  server: {
    port: 3000,
    open: true,
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
  },
  
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
});
