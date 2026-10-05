/**
 * Jest-only Babel plugin: rewrites Vite's `import.meta.env` to a runtime
 * object so modules that read VITE_* variables can be imported in Jest.
 * Tests can set `globalThis.__VITE_ENV__ = { VITE_X: '...' }` before import.
 */
module.exports = function viteEnvPlugin({ types: t }) {
  return {
    name: 'vite-import-meta-env',
    visitor: {
      MemberExpression(path) {
        const { node } = path;
        if (
          t.isMetaProperty(node.object) &&
          node.object.meta.name === 'import' &&
          node.object.property.name === 'meta' &&
          t.isIdentifier(node.property, { name: 'env' })
        ) {
          path.replaceWithSourceString(
            "(globalThis.__VITE_ENV__ || { MODE: 'test', DEV: false, PROD: false, SSR: false })",
          );
        }
      },
    },
  };
};
