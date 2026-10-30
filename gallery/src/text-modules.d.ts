// wrangler bundles an imported .html file as its text (its default module rules); vitest.config.ts does the same for tests.
declare module "*.html" {
  const text: string;
  export default text;
}
