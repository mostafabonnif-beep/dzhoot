import nextConfig from 'eslint-config-next';
import nextTypescriptConfig from 'eslint-config-next/typescript';

const config = [...nextConfig, ...nextTypescriptConfig];

const eslintConfig = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...config.map((entry) => ({
    ...entry,
    rules: {
      ...entry.rules,
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/error-boundaries': 'off',
      'react-hooks/purity': 'off',
    },
  })),
];

export default eslintConfig;
