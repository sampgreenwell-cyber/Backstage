import { AppendError, applyAppend } from './applyAppends';

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
});
