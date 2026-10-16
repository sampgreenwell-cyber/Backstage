/*
 * Adds lines to existing vwstate files without changing or reordering any existing
 * line. A port of Backstage-Templates gmnupr-service/vwstate/apply_appends.py (same
 * rules, same tests); keep the two in step.
 *
 * Modes:
 *   list-end    insert after the last item of a top-level list (`list`, e.g. resources:);
 *               for one-line items only
 *   list-block-end
 *               insert after the whole last item of a top-level list whose items span
 *               several lines (e.g. configMapGenerator:), keeping the list's blank-line
 *               separator
 *   after-last  insert after the last line that starts with `marker`
 *   list-item   add a YAML list item to a file that is one list. Appended at the end
 *               when the file ends with a newline; when it does not, inserted at the
 *               top, because appending would change the last line's ending and show
 *               it as modified.
 * Each file keeps its line endings. An append whose whole text is already in the file
 * is skipped, so a run can be retried.
 */

export type AppendSpec =
  | { file: string; mode: 'list-end'; list: string; text: string }
  | { file: string; mode: 'list-block-end'; list: string; text: string }
  | { file: string; mode: 'after-last'; marker: string; text: string }
  | { file: string; mode: 'list-item'; text: string };

export class AppendError extends Error {}

function newlineOf(text: string): string {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length;
  return crlf && crlf >= lf - crlf ? '\r\n' : '\n';
}

function splitLines(text: string): { lines: string[]; nlEnd: boolean } {
  const nlEnd = text.endsWith('\n');
  const body = nlEnd ? text.slice(0, -1) : text;
  const lines = text ? body.split('\n').map(l => (l.endsWith('\r') ? l.slice(0, -1) : l)) : [];
  return { lines, nlEnd };
}

const trimEnd = (lines: string[]) => lines.map(l => l.trimEnd()).join('\n');

export function applyAppend(text: string, spec: AppendSpec): { text: string; result: string } {
  const nl = newlineOf(text);
  const { lines, nlEnd } = splitLines(text);
  let added = spec.text.replace(/\r\n/g, '\n').split('\n');
  if (trimEnd(lines).includes(trimEnd(added))) {
    return { text, result: 'already present' };
  }

  let at: number;
  if (spec.mode === 'list-end') {
    const header = `${spec.list}:`;
    const start = lines.findIndex(l => l.trimEnd() === header);
    if (start < 0) throw new AppendError(`no top-level '${header}'`);
    let last = start;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].startsWith('- ')) last = i;
      else if (lines[i].trim() && !lines[i].startsWith(' ') && !lines[i].startsWith('#')) break;
    }
    at = last + 1;
  } else if (spec.mode === 'list-block-end') {
    const header = `${spec.list}:`;
    const start = lines.findIndex(l => l.trimEnd() === header);
    if (start < 0) throw new AppendError(`no top-level '${header}'`);
    // The list runs until the next top-level key; its last line is the last non-blank
    // item or indented line before that (top-level comments are not part of it).
    let last = -1;
    let separated = false;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith('- ') || (l.startsWith(' ') && l.trim())) {
        if (last >= 0 && lines[i - 1].trim() === '' && l.startsWith('- ')) separated = true;
        last = i;
      } else if (l.trim() && !l.startsWith('#')) break;
    }
    if (last < 0) throw new AppendError(`'${header}' has no items`);
    if (separated) added = ['', ...added];
    at = last + 1;
  } else if (spec.mode === 'after-last') {
    let last = -1;
    lines.forEach((l, i) => {
      if (l.startsWith(spec.marker)) last = i;
    });
    if (last < 0) throw new AppendError(`no line starting with '${spec.marker}'`);
    at = last + 1;
  } else if (spec.mode === 'list-item') {
    if (nlEnd || lines.length === 0) {
      // A blank separator line, as between the existing items.
      if (lines.length && lines[lines.length - 1].trim()) added = ['', ...added];
      at = lines.length;
    } else {
      const first = lines.findIndex(l => l.startsWith('- '));
      if (first < 0) throw new AppendError('no list item to insert before');
      added = [...added, ''];
      at = first;
    }
  } else {
    throw new AppendError(`unknown mode '${(spec as { mode: string }).mode}'`);
  }

  if (at === lines.length && lines.length && !nlEnd) {
    throw new AppendError('anchor is the last line and has no newline; adding after it would modify it');
  }
  lines.splice(at, 0, ...added);
  return {
    text: lines.join(nl) + (nlEnd ? nl : ''),
    result: `added ${added.length} line(s) at line ${at + 1}`,
  };
}
