// The app narrows discovery to two source directories. The gallery uses Vitest's
// standard test and spec file extensions. Both CI and Vitest read these patterns.
const unitTestPatterns = {
  app: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  gallery: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
};

export default unitTestPatterns;
