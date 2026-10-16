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

/** Workload manifests in a product's base folder (paths relative to kubernetes/). */
export const isWorkloadFile = (p: string) => /^base\/Gemini\/[^/]+\/03_[^/]+\.yaml$/i.test(p);

/**
 * For adding a workload to an existing product: why it cannot be added. The product must
 * have a base folder, and the service name must be free there (no 03_deployment_<service>
 * or 03_cron_job_<service> manifest) and in the product repo's containers.txt (no line
 * with the same image name). `containers` is null when the product repo or its
 * containers.txt cannot be read.
 */
export function findExistingProductProblems(
  product: string,
  service: string,
  imageName: string,
  files: TreeFile[],
  containers: string | null,
): string[] {
  const p = product.toLowerCase();
  const s = service.toLowerCase();
  const base = files.filter(f => f.path.split('/')[0] === 'base' && f.path.split('/')[2]?.toLowerCase() === p);
  if (!base.length) return [`product '${product}' does not exist in vwstate (no kubernetes/base/Gemini/${product}/)`];
  const problems: string[] = [];
  for (const f of base) {
    const name = f.path.split('/')[3]?.toLowerCase();
    if (name === `03_deployment_${s}.yaml` || name === `03_cron_job_${s}.yaml`) {
      problems.push(`service '${service}' already exists in vwstate (kubernetes/${f.path})`);
    }
  }
  if (containers === null) {
    problems.push(`the product repository or its containers.txt cannot be read`);
  } else if (containers.split(/\r?\n/).some(l => l.trim().split(/\s+/)[1] === imageName)) {
    problems.push(`image '${imageName}' is already in the product repository's containers.txt`);
  }
  return problems;
}

/**
 * vwstate:check-product — fails the run, before anything is created. With expect: new
 * (the default) it fails when the product already exists in the target vwstate
 * repository. With expect: existing it fails unless the product exists and the service
 * name is free, and outputs hasRouteFile (whether the product has a k8s route file).
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
        expect: z =>
          z.enum(['new', 'existing']).default('new').describe('new: the product must not exist; existing: it must'),
        service: z => z.string().optional().describe('expect: existing only. Service name that must be free'),
        imageName: z => z.string().optional().describe('expect: existing only. Image name that must be free in containers.txt'),
        productRepoUrl: z =>
          z.string().optional().describe('expect: existing only. Blob URL of the product repository, e.g. https://github.com/<owner>/<repo>/blob/master'),
      },
      output: {
        hasRouteFile: z => z.boolean().optional().describe('expect: existing only. routing/config/gmn-upr-k8s/routes/<product>.yaml exists'),
      },
    },
    async handler(ctx) {
      const base = ctx.input.sourceUrl.replace(/\/+$/, '');
      const existing = ctx.input.expect === 'existing';
      const tree = await options.reader.readTree(`${base}/kubernetes`, {
        filter: p => isProductFile(p) || (existing && isWorkloadFile(p)),
      });
      const files = await Promise.all(
        (await tree.files()).map(async f => ({ path: f.path, content: (await f.content()).toString('utf8') })),
      );
      if (!files.length) throw new Error(`No products found under ${base}/kubernetes; is that the vwstate repository?`);

      if (existing) {
        const { service, imageName, productRepoUrl } = ctx.input;
        if (!service || !imageName || !productRepoUrl) {
          throw new Error('expect: existing needs service, imageName and productRepoUrl');
        }
        let containers: string | null = null;
        try {
          const res = await options.reader.readUrl(`${productRepoUrl.replace(/\/+$/, '')}/containers.txt`);
          containers = (await res.buffer()).toString('utf8');
        } catch (e) {
          if ((e as Error).name !== 'NotFoundError') throw e;
        }
        const problems = findExistingProductProblems(ctx.input.product, service, imageName, files, containers);
        if (problems.length) throw new Error(`Cannot add '${service}' to '${ctx.input.product}': ${problems.join('; ')}.`);
        const routes = await options.reader.readTree(`${base}/routing/config/gmn-upr-k8s/routes`, {
          filter: p => p.toLowerCase() === `${ctx.input.product.toLowerCase()}.yaml`,
        });
        const hasRouteFile = (await routes.files()).length > 0;
        ctx.logger.info(`Product '${ctx.input.product}' exists and '${service}' is free; route file: ${hasRouteFile}.`);
        ctx.output('hasRouteFile', hasRouteFile);
        return;
      }

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
