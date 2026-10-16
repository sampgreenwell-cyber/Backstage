import { AppendError, applyAppend, projectGuid } from './applyAppends';

// Same cases as gmnupr-service/vwstate/test_apply_appends.py.
const ENV_KUSTOMIZATION =
  'kind: Kustomization\r\n\r\nresources:\r\n- finance/\r\n- insurance/\r\n- dataextractor/\r\n' +
  '\r\npatches:\r\n- path: runtime/deployment-replicas.patch.yaml\r\n';
const VHOST =
  'name: dev1-upr-k8s\r\nroutes:\r\n#@cmd/append file=../../routes/core.yaml\r\n' +
  '#@cmd/append file=../../routes/legacy.yaml\r\n\r\n';
const VHOST_WITH_FILTERS =
  'routes:\r\n#@cmd/append file=../../routes/legacy.yaml\r\ntyped_per_filter_config:\r\n  lua: end';
const CLUSTERS_NO_NEWLINE = '- "@type": Cluster\r\n  name: a\r\n  health_checks: []\r\n  ';
const CLUSTERS_NEWLINE = '- "@type": Cluster\n  name: a\n  health_checks: []\n';
const CLUSTER = '- "@type": Cluster\n  name: claimsx-intake-webapi\n  health_checks: []';
const INCLUDE = {
  file: 'v.yaml',
  mode: 'after-last' as const,
  marker: '#@cmd/append file=../../routes/',
  text: '#@cmd/append file=../../routes/claimsx.yaml',
};
const RESOURCES = { file: 'k.yaml', mode: 'list-end' as const, list: 'resources', text: '- claimsx/' };
// Multi-line configMapGenerator entries, as in a product base (LF) and an env overlay (CRLF).
const BASE_KUSTOMIZATION =
  'namespace: gemini-demo\n\nconfigMapGenerator:\n- name: intake-webapi-config\n' +
  '  files:\n  - appsettings.json=intake-webapi-config.appsettings.json\n  options:\n' +
  '    disableNameSuffixHash: true\n\n- name: intake-webapi-startup-config\n' +
  '  behavior: create\n  options:\n    disableNameSuffixHash: true\n\n' +
  'resources:\n- 01_namespace.yaml\n';
const OVERLAY_KUSTOMIZATION =
  'configMapGenerator:\r\n- name: admin-webapi-config\r\n  behavior: merge\r\n' +
  '  files:\r\n  - appsettings.override.json=admin-webapi-config.override.json \r\n\r\n' +
  '- name: admin-webapi-startup-config\r\n  behavior: merge\r\n  literals:\r\n' +
  '  - HostStartup__DisableAzureAppConfiguration=false\r\n\r\n' +
  'resources:\r\n- ../../../base/Gemini/demo\r\n';
const CONFIG_ENTRY =
  '- name: events-config\n  behavior: merge\n  files:\n  - appsettings.override.json=events-config.override.json';
const BLOCK = { file: 'k.yaml', mode: 'list-block-end' as const, list: 'configMapGenerator', text: CONFIG_ENTRY };
// A product solution with one project, CRLF and tabs as Visual Studio writes it.
const SLN =
  'Microsoft Visual Studio Solution File, Format Version 12.00\r\n' +
  'Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "Gemini.DemoA.Intake.WebApi", ' +
  '"Gemini.DemoA.Intake.WebApi\\Gemini.DemoA.Intake.WebApi.csproj", "{6F1C2A57-3D0B-4E7A-9B1F-2C5D8E4A7B10}"\r\n' +
  'EndProject\r\nGlobal\r\n\tGlobalSection(SolutionConfigurationPlatforms) = preSolution\r\n' +
  '\t\tDebug|Any CPU = Debug|Any CPU\r\n\t\tRelease|Any CPU = Release|Any CPU\r\n\tEndGlobalSection\r\n' +
  '\tGlobalSection(ProjectConfigurationPlatforms) = postSolution\r\n' +
  '\t\t{6F1C2A57-3D0B-4E7A-9B1F-2C5D8E4A7B10}.Debug|Any CPU.ActiveCfg = Debug|Any CPU\r\n' +
  '\tEndGlobalSection\r\nEndGlobal\r\n';
const SLN_PROJECT = {
  file: 'src/Gemini.DemoA.sln',
  mode: 'sln-project' as const,
  name: 'Gemini.DemoA.Consumer.Events',
  path: 'Gemini.DemoA.Consumer.Events\\Gemini.DemoA.Consumer.Events.csproj',
};
// Same value as test_apply_appends.py: both implementations must agree.
const EVENTS_GUID = '{276243DB-C4F3-5384-BD23-83733D76A33F}';
// The product repo's container list: one "<project path> <image name>" line per workload.
const CONTAINER = {
  file: 'containers.txt',
  mode: 'after-last' as const,
  marker: 'src/',
  text: 'src/Gemini.DemoA.Consumer.Events gemini-demo-a-consumer-events',
};

/** Existing lines, in order, must all survive unchanged. */
function expectOnlyAdded(before: string, after: string) {
  const old = before.split('\n');
  const now = after.split('\n');
  let j = 0;
  for (const line of now) if (j < old.length && line === old[j]) j++;
  expect(j).toBe(old.length);
}

describe('applyAppend', () => {
  it('adds a resources line after the last item', () => {
    const { text } = applyAppend(ENV_KUSTOMIZATION, RESOURCES);
    expect(text).toContain('- dataextractor/\r\n- claimsx/\r\n\r\npatches:');
    expectOnlyAdded(ENV_KUSTOMIZATION, text);
  });

  it('adds a vhost include after the last include', () => {
    const { text } = applyAppend(VHOST, INCLUDE);
    expect(text.endsWith('legacy.yaml\r\n#@cmd/append file=../../routes/claimsx.yaml\r\n\r\n')).toBe(true);
    expectOnlyAdded(VHOST, text);
  });

  it('adds inside a file that has no final newline', () => {
    const { text } = applyAppend(VHOST_WITH_FILTERS, INCLUDE);
    expect(text).toContain('legacy.yaml\r\n#@cmd/append file=../../routes/claimsx.yaml\r\ntyped_per_filter_config:');
    expect(text.endsWith('  lua: end')).toBe(true);
    expectOnlyAdded(VHOST_WITH_FILTERS, text);
  });

  it('appends a list item when the file ends with a newline', () => {
    const { text } = applyAppend(CLUSTERS_NEWLINE, { file: 'c.yaml', mode: 'list-item', text: CLUSTER });
    expect(text.endsWith(`health_checks: []\n\n${CLUSTER}\n`)).toBe(true);
    expectOnlyAdded(CLUSTERS_NEWLINE, text);
  });

  it('prepends a list item when the file has no final newline', () => {
    const { text } = applyAppend(CLUSTERS_NO_NEWLINE, { file: 'c.yaml', mode: 'list-item', text: CLUSTER });
    expect(text.startsWith(`${CLUSTER.replace(/\n/g, '\r\n')}\r\n\r\n- "@type": Cluster\r\n  name: a`)).toBe(true);
    expect(text.endsWith('health_checks: []\r\n  ')).toBe(true);
    expectOnlyAdded(CLUSTERS_NO_NEWLINE, text);
  });

  it('is a no-op the second time', () => {
    const once = applyAppend(ENV_KUSTOMIZATION, RESOURCES).text;
    const twice = applyAppend(once, RESOURCES);
    expect(twice.text).toBe(once);
    expect(twice.result).toBe('already present');
  });

  it('fails when the anchor is missing', () => {
    expect(() => applyAppend('kind: Kustomization\n', RESOURCES)).toThrow(AppendError);
  });

  it('adds a block entry after the whole last entry (LF)', () => {
    const { text } = applyAppend(BASE_KUSTOMIZATION, BLOCK);
    expect(text).toContain(`    disableNameSuffixHash: true\n\n${CONFIG_ENTRY}\n\nresources:`);
    expect(text).toContain('- name: intake-webapi-startup-config\n  behavior: create\n');
    expectOnlyAdded(BASE_KUSTOMIZATION, text);
  });

  it('adds a block entry and keeps CRLF', () => {
    const { text } = applyAppend(OVERLAY_KUSTOMIZATION, BLOCK);
    const entry = CONFIG_ENTRY.replace(/\n/g, '\r\n');
    expect(text).toContain(`DisableAzureAppConfiguration=false\r\n\r\n${entry}\r\n\r\nresources:`);
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expectOnlyAdded(OVERLAY_KUSTOMIZATION, text);
  });

  it('adds a block entry to a list at the end of the file', () => {
    const before = 'configMapGenerator:\n- name: a\n  behavior: merge\n';
    expect(applyAppend(before, BLOCK).text).toBe(`${before}${CONFIG_ENTRY}\n`);
  });

  it('adds a block entry before a top-level comment', () => {
    const before = 'configMapGenerator:\n- name: a\n  behavior: merge\n# resources follow\nresources:\n- x\n';
    const { text } = applyAppend(before, BLOCK);
    expect(text).toContain(`  behavior: merge\n${CONFIG_ENTRY}\n# resources follow\n`);
    expectOnlyAdded(before, text);
  });

  it('adds a project block and its configuration lines to a .sln', () => {
    expect(projectGuid(SLN_PROJECT.path)).toBe(EVENTS_GUID);
    const { text } = applyAppend(SLN, SLN_PROJECT);
    expect(text).toContain(
      'Gemini.DemoA.Intake.WebApi.csproj", "{6F1C2A57-3D0B-4E7A-9B1F-2C5D8E4A7B10}"\r\nEndProject\r\n' +
        'Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "Gemini.DemoA.Consumer.Events", ' +
        `"Gemini.DemoA.Consumer.Events\\Gemini.DemoA.Consumer.Events.csproj", "${EVENTS_GUID}"\r\nEndProject\r\nGlobal\r\n`,
    );
    expect(text).toContain(
      `Debug|Any CPU\r\n\t\t${EVENTS_GUID}.Debug|Any CPU.ActiveCfg = Debug|Any CPU\r\n` +
        `\t\t${EVENTS_GUID}.Debug|Any CPU.Build.0 = Debug|Any CPU\r\n` +
        `\t\t${EVENTS_GUID}.Release|Any CPU.ActiveCfg = Release|Any CPU\r\n` +
        `\t\t${EVENTS_GUID}.Release|Any CPU.Build.0 = Release|Any CPU\r\n` +
        '\tEndGlobalSection\r\nEndGlobal\r\n',
    );
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expectOnlyAdded(SLN, text);
  });

  it('is a no-op the second time for a .sln project', () => {
    const once = applyAppend(SLN, SLN_PROJECT).text;
    expect(applyAppend(once, SLN_PROJECT)).toEqual({ text: once, result: 'already present' });
  });

  it('fails on a .sln without a configuration section', () => {
    expect(() =>
      applyAppend('Project("{X}") = "a", "a.csproj", "{Y}"\nEndProject\nGlobal\nEndGlobal\n', SLN_PROJECT),
    ).toThrow(AppendError);
  });

  it('adds a container line after the last one', () => {
    const before = 'src/Gemini.DemoA.Intake.WebApi gemini-demo-a-intake-webapi\n';
    expect(applyAppend(before, CONTAINER).text).toBe(`${before}${CONTAINER.text}\n`);
  });

  it('refuses a container list without a final newline', () => {
    expect(() => applyAppend('src/Gemini.DemoA.Intake.WebApi gemini-demo-a-intake-webapi', CONTAINER)).toThrow(
      AppendError,
    );
  });

  it('is a no-op the second time for a block entry', () => {
    const once = applyAppend(BASE_KUSTOMIZATION, BLOCK).text;
    expect(applyAppend(once, BLOCK)).toEqual({ text: once, result: 'already present' });
  });
});
