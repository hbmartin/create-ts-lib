/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: {
        couldNotResolve: true,
      },
    },
    {
      name: "no-undeclared-packages",
      severity: "error",
      from: {},
      to: {
        dependencyTypes: ["npm-no-pkg", "npm-unknown"],
      },
    },
    {
      name: "source-not-to-test",
      severity: "error",
      from: {
        path: "^source/",
      },
      to: {
        path: "^test/",
      },
    },
    {
      name: "source-not-to-dev-dependencies",
      severity: "error",
      from: {
        path: "^source/",
      },
      to: {
        dependencyTypes: ["npm-dev"],
        dependencyTypesNot: ["type-only"],
        pathNot: ["^node_modules/@types/"],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: ["node_modules"],
    },
    enhancedResolveOptions: {
      conditionNames: ["import", "node", "types", "default"],
      exportsFields: ["exports"],
      mainFields: ["module", "main", "types", "typings"],
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    tsPreCompilationDeps: "specify",
  },
};
