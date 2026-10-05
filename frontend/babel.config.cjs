// Used only by Jest (Vite uses esbuild and ignores this file).
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
  plugins: ['./test-utils/babel-plugin-vite-env.cjs'],
};
