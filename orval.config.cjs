module.exports = {
  leadpilot: {
    input: {
      target: './packages/shared-types/openapi.json',
    },
    output: {
      mode: 'tags-split',
      target: './apps/web/lib/api-generated/index.ts',
      schemas: './apps/web/lib/api-generated/model',
      client: 'react-query',
      httpClient: 'custom',
      packageJson: './apps/web/package.json',
      override: {
        mutator: {
          path: './apps/web/lib/custom-instance.ts',
          name: 'customInstance',
        },
        query: {
          version: 5,
          useQuery: true,
          useMutation: true,
          signal: true,
        },
      },
    },
  },
};
