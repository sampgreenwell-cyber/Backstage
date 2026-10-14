import { findProductConflicts, isProductFile } from './checkProduct';

const FILES = [
  { path: 'base/Gemini/Insurance/kustomization.yaml', content: 'namespace: gemini-insurance\n' },
  { path: 'base/Gemini/Insurance/01_namespace.yaml', content: 'kind: Namespace\nmetadata:\n  name: gemini-insurance\n' },
  { path: 'overlays/gmnupr/dev1/routing/kustomization.yaml', content: 'namespace: gemini-routing\n' },
  { path: 'overlays/gmnupr/dev1/insurance/kustomization.yaml', content: 'configMapGenerator:\n- name: x\n  namespace: gemini-insurance\n' },
];

describe('findProductConflicts', () => {
  it('finds an existing product folder, case-insensitively', () => {
    expect(findProductConflicts('insurance', FILES)).toEqual(
      expect.arrayContaining(['kubernetes/base/Gemini/Insurance/', 'kubernetes/overlays/gmnupr/dev1/insurance/']),
    );
  });

  it('finds a product that exists only as an overlay namespace', () => {
    expect(findProductConflicts('routing', FILES)).toEqual(
      expect.arrayContaining(['kubernetes/overlays/gmnupr/dev1/routing/', 'namespace gemini-routing (kubernetes/overlays/gmnupr/dev1/routing/kustomization.yaml)']),
    );
  });

  it('passes a new product', () => {
    expect(findProductConflicts('claimsx', FILES)).toEqual([]);
  });

  it('does not match a product that only shares a prefix', () => {
    expect(findProductConflicts('insur', FILES)).toEqual([]);
  });
});

describe('isProductFile', () => {
  it('keeps only product kustomizations and namespaces', () => {
    expect(isProductFile('base/Gemini/insurance/kustomization.yaml')).toBe(true);
    expect(isProductFile('overlays/gmnupr/pp1/finance/kustomization.yaml')).toBe(true);
    expect(isProductFile('base/Gemini/insurance/03_deployment_admin.yaml')).toBe(false);
    expect(isProductFile('overlays/gmnupr/dev1/kustomization.yaml')).toBe(false);
  });
});
