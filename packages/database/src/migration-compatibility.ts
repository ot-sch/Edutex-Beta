/** @fileoverview Exact RC5-to-RC6 migration correction receipts; no other changed migration is accepted. */
export const migrationCorrections: Readonly<
  Record<string, { readonly original: string; readonly corrected: string }>
> = {
  '0004_security_audit_rls.sql': {
    original: 'ed9df2cb8707c31aeb1a062d2b5d2f54aa0c0087dca8c508bf557968a5ceff42',
    corrected: 'ad859cafc37c3e21c1c68da9f101dc203c7bb810f02774e3e825d80fe2da79c3',
  },
  '0006_authentication_runtime.sql': {
    original: 'c999fb7b0eb77d648d5cf5e6c16ab3004f3e9a85806fb53ec359cd33b3d0f13f',
    corrected: 'afa3b03ef987aa3f3547233d502ab524b88ca707e94b8da7b60d0bf1216cb05f',
  },
  '0009_federated_entitlement_reconciliation.sql': {
    original: '61c7f28d0571d08fcc0927373a4ca68b8dc89751a38a41f85d9ff288bba3e36f',
    corrected: 'fea92d7f6e817369dabf6d640ce4d8c1c3863d8062dc541cdb8f136cfb9de984',
  },
};
