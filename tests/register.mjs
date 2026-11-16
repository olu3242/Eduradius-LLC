import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier === 'cloudflare:workers' || specifier === '@/lib/server/platform')) {
      return { url: new URL('./helpers/worker-env.mjs', import.meta.url).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const target = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(target))) return nextResolve(target.href, context);
    }
    return nextResolve(specifier, context);
  },
});
