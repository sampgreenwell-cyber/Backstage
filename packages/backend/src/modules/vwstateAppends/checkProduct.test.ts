import { findExistingProductProblems, findProductConflicts, isProductFile, isWorkloadFile } from './checkProduct';

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

describe('isWorkloadFile', () => {
  it('keeps only base workload manifests', () => {
    expect(isWorkloadFile('base/Gemini/demo-a/03_deployment_intake.yaml')).toBe(true);
    expect(isWorkloadFile('base/Gemini/demo-a/03_cron_job_nightly.yaml')).toBe(true);
    expect(isWorkloadFile('base/Gemini/demo-a/04_service_intake.yaml')).toBe(false);
    expect(isWorkloadFile('overlays/gmnupr/dev1/demo-a/03_deployment_intake.yaml')).toBe(false);
  });
});

describe('findExistingProductProblems', () => {
  const PRODUCT = [
    { path: 'base/Gemini/demo-a/kustomization.yaml', content: 'namespace: gemini-demo-a\n' },
    { path: 'base/Gemini/demo-a/03_deployment_intake.yaml', content: 'kind: Deployment\n' },
    ...FILES,
  ];
  const CONTAINERS = 'src/Gemini.DemoA.Intake.WebApi gemini-demo-a-intake-webapi\n';

  it('passes a free service name in an existing product', () => {
    expect(findExistingProductProblems('demo-a', 'events', 'gemini-demo-a-consumer-events', PRODUCT, CONTAINERS)).toEqual([]);
  });

  it('fails a product that does not exist', () => {
    const problems = findExistingProductProblems('nosuchproduct', 'events', 'x', PRODUCT, CONTAINERS);
    expect(problems).toEqual([expect.stringContaining("product 'nosuchproduct' does not exist")]);
  });

  it('fails a service name already in the base folder, case-insensitively', () => {
    const problems = findExistingProductProblems('Demo-A', 'Intake', 'gemini-demo-a-intake-webapi', PRODUCT, CONTAINERS);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("service 'Intake' already exists"),
        expect.stringContaining("image 'gemini-demo-a-intake-webapi' is already"),
      ]),
    );
  });

  it('fails when the product repository has no containers.txt', () => {
    expect(findExistingProductProblems('demo-a', 'events', 'x', PRODUCT, null)).toEqual([
      expect.stringContaining('cannot be read'),
    ]);
  });
});
