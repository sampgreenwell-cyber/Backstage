import { UrlReaderService } from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';

export type TreeFile = { path: string; content: string };

/** Only these files are needed to know which products exist (paths relative to kubernetes/). */
export const isProductFile = (p: string) =>
  /^(base\/Gemini\/[^/]+|overlays\/gmnupr\/[^/]+\/[^/]+)\/(kustomization\.yaml|01_namespace\.yaml)$/i.test(p);

/**
 * Where `product` already exists in vwstate: a folder under base/Gemini/, a folder in any
 * gmnupr environment overlay, or a `gemini-<product>` namespace. Case-insensitive, as
 * vwstate is used from Windows too.
 */
export function findProductConflicts(product: string, files: TreeFile[]): string[] {
  const p = product.toLowerCase();
  const hits = new Set<string>();
  for (const f of files) {
    const parts = f.path.split('/');
    if (parts[0] === 'base' && parts[2]?.toLowerCase() === p) hits.add(`kubernetes/base/Gemini/${parts[2]}/`);
    if (parts[0] === 'overlays' && parts[3]?.toLowerCase() === p) hits.add(`kubernetes/overlays/gmnupr/${parts[2]}/${parts[3]}/`);
    const ns = new RegExp(`^\\s*(namespace|name):\\s*['"]?gemini-${p.replace(/[-]/g, '\\-')}['"]?\\s*$`, 'im');
    if ((f.path.endsWith('kustomization.yaml') && /^\s*namespace:/im.test(f.content) && ns.test(f.content)) ||
        (f.path.endsWith('01_namespace.yaml') && ns.test(f.content))) {
      hits.add(`namespace gemini-${p} (kubernetes/${f.path})`);
    }
  }
  return [...hits].sort();
}

/**
 * vwstate:check-product — fails the run, before anything is created, when the product
 * already exists in the target vwstate repository.
 */
export function createCheckProductAction(options: { reader: UrlReaderService }) {
  return createTemplateAction({
    id: 'vwstate:check-product',
    description: 'Fails if a Gemini product already exists in vwstate (folder or gemini-<product> namespace).',
    supportsDryRun: true,
    schema: {
      input: {
        sourceUrl: z => z.string().describe('Tree URL of the vwstate repository, e.g. https://github.com/<owner>/<repo>/tree/master'),
        product: z => z.string().describe('Product name to check'),
      },
    },
    async handler(ctx) {
      const base = ctx.input.sourceUrl.replace(/\/+$/, '');
      const tree = await options.reader.readTree(`${base}/kubernetes`, { filter: p => isProductFile(p) });
      const files = await Promise.all(
        (await tree.files()).map(async f => ({ path: f.path, content: (await f.content()).toString('utf8') })),
      );
      if (!files.length) throw new Error(`No products found under ${base}/kubernetes; is that the vwstate repository?`);
      const conflicts = findProductConflicts(ctx.input.product, files);
      if (conflicts.length) {
        const shown = conflicts.slice(0, 3).join('; ');
        const more = conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : '';
        throw new Error(`Product '${ctx.input.product}' already exists in vwstate (${shown}${more}). Choose a new product name.`);
      }
      ctx.logger.info(`Product '${ctx.input.product}' is new (checked ${files.length} files).`);
    },
  });
}
