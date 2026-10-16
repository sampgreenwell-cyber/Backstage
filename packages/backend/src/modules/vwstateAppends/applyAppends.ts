import { createHash } from 'crypto';

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
 *   sln-project add a C# project to a Visual Studio .sln: its Project ... EndProject block
 *               after the last EndProject, and its Debug/Release configuration lines at
 *               the end of the ProjectConfigurationPlatforms section. The project GUID is a
 *               name-based UUID (v5) of the project path, so the same input always gives
 *               the same GUID.
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
  | { file: string; mode: 'list-item'; text: string }
  | { file: string; mode: 'sln-project'; name: string; path: string };

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

// Fixed namespace for project GUIDs; changing it changes every generated GUID.
const PROJECT_GUID_NAMESPACE = 'b3f0c0de-5e1a-4c2b-9d7e-6a1f2e3d4c5b';
// Visual Studio's project type GUID for SDK-style C# projects.
const CSHARP_PROJECT_TYPE = '{9A19103F-16F7-4668-BE54-9A1E7A4F7556}';

/** RFC 4122 version 5 UUID, upper case in braces as .sln files write it. */
export function projectGuid(projectPath: string): string {
  const ns = Buffer.from(PROJECT_GUID_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(projectPath, 'utf8')])).digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex').toUpperCase();
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}`;
}

function addSlnProject(text: string, spec: { name: string; path: string }): { text: string; result: string } {
  const nl = newlineOf(text);
  const { lines, nlEnd } = splitLines(text);
  const guid = projectGuid(spec.path);
  if (text.includes(guid)) return { text, result: 'already present' };
  let lastEnd = -1;
  lines.forEach((l, i) => {
    if (l.trimEnd() === 'EndProject') lastEnd = i;
  });
  if (lastEnd < 0) throw new AppendError("no 'EndProject' line");
  const section = lines.findIndex(l => l.trim().startsWith('GlobalSection(ProjectConfigurationPlatforms)'));
  if (section < 0) throw new AppendError("no 'GlobalSection(ProjectConfigurationPlatforms)'");
  const sectionEnd = lines.findIndex((l, i) => i > section && l.trim() === 'EndGlobalSection');
  if (sectionEnd < 0) throw new AppendError('ProjectConfigurationPlatforms section is not closed');
  const indent = lines[sectionEnd].slice(0, lines[sectionEnd].indexOf('EndGlobalSection'));
  const config = ['Debug', 'Release'].flatMap(c => [
    `${indent}${indent}${guid}.${c}|Any CPU.ActiveCfg = ${c}|Any CPU`,
    `${indent}${indent}${guid}.${c}|Any CPU.Build.0 = ${c}|Any CPU`,
  ]);
  // Configuration lines first, so the Project block's insert does not move sectionEnd.
  lines.splice(sectionEnd, 0, ...config);
  lines.splice(lastEnd + 1, 0, `Project("${CSHARP_PROJECT_TYPE}") = "${spec.name}", "${spec.path}", "${guid}"`, 'EndProject');
  return {
    text: lines.join(nl) + (nlEnd ? nl : ''),
    result: `added project ${spec.name} ${guid} (6 lines)`,
  };
}

export function applyAppend(text: string, spec: AppendSpec): { text: string; result: string } {
  if (spec.mode === 'sln-project') return addSlnProject(text, spec);
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
