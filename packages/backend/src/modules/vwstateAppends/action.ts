import fs from 'fs/promises';
import path from 'path';
import { UrlReaderService, resolveSafeChildPath } from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { AppendSpec, applyAppend } from './applyAppends';

/**
 * vwstate:apply-appends — for each entry in a rendered vwstate-appends.json, reads the
 * file's current content from the target repository (through the configured
 * integrations), adds the lines, and writes the result to the workspace, so
 * publish:github:pull-request commits additions only.
 */
export function createApplyAppendsAction(options: { reader: UrlReaderService }) {
  return createTemplateAction({
    id: 'vwstate:apply-appends',
    description:
      'Adds lines to existing files of a repository (read at sourceUrl) and writes them into the workspace, without changing or reordering existing lines.',
    supportsDryRun: true,
    schema: {
      input: {
        sourceUrl: z =>
          z.string().describe('Base URL of the files to update, e.g. https://github.com/<owner>/<repo>/blob/master'),
        appendsPath: z => z.string().describe('Workspace path of the rendered vwstate-appends.json'),
        targetPath: z => z.string().describe('Workspace directory to write the updated files into'),
      },
      output: {
        files: z => z.array(z.string()).describe('Files written, relative to targetPath'),
      },
    },
    async handler(ctx) {
      const { sourceUrl, appendsPath, targetPath } = ctx.input;
      const specs: AppendSpec[] = JSON.parse(
        await fs.readFile(resolveSafeChildPath(ctx.workspacePath, appendsPath), 'utf8'),
      ).appends;
      const base = sourceUrl.replace(/\/+$/, '');

      // Several appends can target one file; apply them in order to the same text.
      const updated = new Map<string, string>();
      for (const spec of specs) {
        if (spec.file.split('/').includes('..')) throw new Error(`Refusing path outside the repository: ${spec.file}`);
        let text = updated.get(spec.file);
        if (text === undefined) {
          const response = await options.reader.readUrl(`${base}/${spec.file}`);
          text = (await response.buffer()).toString('utf8');
        }
        const { text: next, result } = applyAppend(text, spec);
        ctx.logger.info(`${spec.file}: ${result}`);
        updated.set(spec.file, next);
      }

      for (const [file, text] of updated) {
        const out = resolveSafeChildPath(resolveSafeChildPath(ctx.workspacePath, targetPath), file);
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, text, 'utf8');
      }
      ctx.output('files', [...updated.keys()]);
    },
  });
}
