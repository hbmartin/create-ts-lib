import { renderBiomeJsonc } from "./biome.js";

export type PackageManager = "pnpm" | "npm" | "yarn";
export type LicenseName = "MIT" | "ISC" | "Apache-2.0" | "UNLICENSED";

export interface ScaffoldConfig {
  author: string;
  description: string;
  githubRepoUrl: string;
  includeCli: boolean;
  includeCodecov: boolean;
  includeReleasePlease: boolean;
  license: LicenseName;
  packageManager: PackageManager;
  projectName: string;
}

export interface GeneratedFile {
  content: string;
  executable?: boolean;
  path: string;
}

const packageManagerConfig = {
  npm: {
    auditCommand: "npm audit --omit=dev",
    buildCommand: "npm run build",
    cache: "npm",
    commitlintCommand: "npx --no -- commitlint --edit \"$1\"",
    installCiCommand: "npm ci",
    installCommand: "npm install",
    publintCommand: "npx --no -- publint --pack npm",
    runPrefix: "npm run",
  },
  pnpm: {
    auditCommand: "pnpm audit --prod",
    buildCommand: "pnpm run build",
    cache: "pnpm",
    commitlintCommand: "pnpm exec commitlint --edit \"$1\"",
    installCiCommand: "pnpm install --frozen-lockfile",
    installCommand: "pnpm install",
    publintCommand: "pnpm exec publint --pack npm",
    runPrefix: "pnpm run",
  },
  yarn: {
    auditCommand: "yarn npm audit --environment production",
    buildCommand: "yarn run build",
    cache: "yarn",
    commitlintCommand: "yarn commitlint --edit \"$1\"",
    installCiCommand: "yarn install --immutable",
    installCommand: "yarn install",
    publintCommand: "yarn publint --pack npm",
    runPrefix: "yarn run",
  },
} satisfies Record<PackageManager, {
  auditCommand: string;
  buildCommand: string;
  cache: string;
  commitlintCommand: string;
  installCiCommand: string;
  installCommand: string;
  publintCommand: string;
  runPrefix: string;
}>;

const repositoryFields = (githubRepoUrl: string) => {
  if (githubRepoUrl.length === 0) {
    return {};
  }

  const normalizedUrl = githubRepoUrl.replace(/\.git$/u, "");
  return {
    bugs: {
      url: `${normalizedUrl}/issues`,
    },
    homepage: `${normalizedUrl}#readme`,
    repository: {
      type: "git",
      url: `${normalizedUrl}.git`,
    },
  };
};

const buildPackageJson = (config: ScaffoldConfig): string => {
  const packageJson = {
    ...repositoryFields(config.githubRepoUrl),
    author: config.author,
    dependencies: {
      ...(config.includeCli ? { meow: "^14.0.0" } : {}),
      zod: "^4.3.6",
    },
    description: config.description,
    engines: {
      node: ">=22",
    },
    exports: {
      ".": {
        default: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
    },
    files: ["dist"],
    ...(config.includeCli
      ? {
          bin: {
            [getBinName(config.projectName)]: "dist/cli.js",
          },
        }
      : {}),
    license: config.license,
    name: config.projectName,
    resolutions: {
      "@types/node": "^22",
    },
    scripts: {
      build: "tsc -p tsconfig.build.json",
      dev: "tsc --watch",
      format: "biome check --write",
      lint: "biome check --error-on-warnings",
      prepare: "husky",
      test: "vitest run --coverage",
      typecheck: "tsc --noEmit",
    },
    type: "module",
    version: "0.1.0",
    devDependencies: {
      "@biomejs/biome": "^2.3.15",
      "@commitlint/cli": "^20.4.1",
      "@commitlint/config-conventional": "^20.4.1",
      "@sindresorhus/tsconfig": "^8.1.0",
      "@types/node": "^22",
      "@vitest/coverage-istanbul": "^4.0.18",
      husky: "^9.1.7",
      publint: "^0.3.17",
      typescript: "^5.9.3",
      vitest: "^4.0.18",
    },
  };

  return `${JSON.stringify(packageJson, null, 2)}\n`;
};

const buildTsConfig = (): string => `{
  "extends": "@sindresorhus/tsconfig",
  "compilerOptions": {
    "outDir": "dist",
    "noUnusedLocals": false,
    "erasableSyntaxOnly": false
  },
  "include": ["source"]
}
`;

const buildTsConfigBuild = (): string => `{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true
  }
}
`;

const buildVitestConfig = (): string => `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["lcov", "text"],
      include: ["source/**/*.ts"],
      exclude: ["test/**/*.test.ts"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
`;

const buildCiWorkflow = (config: ScaffoldConfig): string => {
  const pmConfig = packageManagerConfig[config.packageManager];
  const packageManagerSetup =
    config.packageManager === "pnpm"
      ? `      - uses: pnpm/action-setup@v4
        with:
          version: 9`
      : `      - run: corepack enable`;
  const packageManagerCache = `          cache: "${pmConfig.cache}"`;
  const publishCommands = [
    `      - run: ${pmConfig.installCiCommand}`,
    `      - run: ${pmConfig.auditCommand}`,
    `      - uses: biomejs/setup-biome@v2`,
    `      - run: biome ci .`,
    `      - run: ${pmConfig.buildCommand}`,
    `      - run: ${pmConfig.publintCommand}`,
    `      - run: ${pmConfig.runPrefix} test`,
  ];

  if (config.includeCodecov) {
    publishCommands.push(`      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v5
        with:
          token: \${{ secrets.CODECOV_TOKEN }}
          fail_ci_if_error: true`);
  }

  return `name: ci
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${packageManagerSetup}
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
${packageManagerCache}
${publishCommands.join("\n")}
`;
};

const buildSemanticPrWorkflow = (): string => `name: semantic-pr
on:
  pull_request_target:
    types: [opened, edited, synchronize, reopened]

permissions:
  pull-requests: read
  statuses: write

jobs:
  main:
    runs-on: ubuntu-latest
    steps:
      - uses: amannn/action-semantic-pull-request@v5
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

const buildReleasePleaseWorkflow = (config: ScaffoldConfig): string => {
  const pmConfig = packageManagerConfig[config.packageManager];
  const packageManagerSetup =
    config.packageManager === "pnpm"
      ? `      - uses: pnpm/action-setup@v4
        with:
          version: 9`
      : `      - run: corepack enable`;

  return `name: release-please
on:
  push:
    branches: [main]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: \${{ steps.release.outputs.release_created }}
    steps:
      - id: release
        uses: googleapis/release-please-action@v4
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  publish:
    needs: release-please
    if: \${{ needs.release-please.outputs.release_created == 'true' }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
${packageManagerSetup}
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
          cache: "${pmConfig.cache}"
          registry-url: "https://registry.npmjs.org"
      - run: ${pmConfig.installCiCommand}
      - run: ${pmConfig.buildCommand}
      - name: Publish package
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
        run: |
          VERSION="$(node --input-type=module -e "import packageJson from './package.json' with { type: 'json' }; process.stdout.write(packageJson.version);")"
          if [[ "$VERSION" == *-* ]]; then
            npm publish --provenance --tag next
          else
            npm publish --provenance
          fi
`;
};

const buildReleasePleaseConfig = (config: ScaffoldConfig): string => `{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": {
      "package-name": "${config.projectName}",
      "release-type": "node"
    }
  }
}
`;

const buildReleasePleaseManifest = (): string => `{
  ".": "0.1.0"
}
`;

const buildGitIgnore = (): string => `node_modules
dist
coverage
.nyc_output
.DS_Store
*.log
.vscode
.idea
package-lock.json
yarn.lock
report/
`;

const buildCommitlintConfig = (): string => `export default {
  extends: ["@commitlint/config-conventional"],
};
`;

const buildHuskyCommitMsg = (packageManager: PackageManager): string => `#!/usr/bin/env sh
${packageManagerConfig[packageManager].commitlintCommand}
`;

const buildLicense = (license: LicenseName, author: string): string => {
  const year = new Date().getUTCFullYear();
  const authorName = extractAuthorName(author);

  switch (license) {
    case "Apache-2.0":
      return `Apache License
Version 2.0, January 2004
https://www.apache.org/licenses/

Copyright ${year} ${authorName}

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`;
    case "ISC":
      return `ISC License

Copyright (c) ${year}, ${authorName}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
`;
    case "MIT":
      return `MIT License

Copyright (c) ${year} ${authorName}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
    case "UNLICENSED":
      return `UNLICENSED

Copyright (c) ${year} ${authorName}

All rights reserved.
`;
  }
};

const buildSourceIndex = (): string => `export type { BrandedId } from "./types/index.js";
export { formatValue } from "./utils/formatting.js";
`;

const buildSourceTypes = (): string => `export type BrandedId<T extends string> = string & {
  readonly __brand: T;
};
`;

const buildSourceFormatting = (): string => `export const formatValue = (value: unknown): string => {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value) ?? "";
};
`;

const buildSourceCli = (projectName: string): string => `#!/usr/bin/env node
import meow from "meow";

meow(
  \`
  Usage
    $ ${getBinName(projectName)} <input>

  Options
    --help     Show help
    --version  Show version
  \`,
  { importMeta: import.meta },
);
`;

const buildFormattingTest = (): string => `import { describe, expect, it } from "vitest";

import { formatValue } from "../../source/utils/formatting.js";

describe("formatValue", () => {
  it("returns empty string for undefined", () => {
    expect(formatValue(undefined)).toBe("");
  });

  it("returns string values directly", () => {
    expect(formatValue("hello")).toBe("hello");
  });

  it("JSON-serializes non-string values", () => {
    expect(formatValue(42)).toBe("42");
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });
});
`;

export const getBinName = (projectName: string): string =>
  projectName.replace(/^@[^/]+\//u, "");

export const buildProjectFiles = (config: ScaffoldConfig): GeneratedFile[] => {
  const files: GeneratedFile[] = [
    {
      content: buildGitIgnore(),
      path: ".gitignore",
    },
    {
      content: renderBiomeJsonc(config.includeCli),
      path: "biome.jsonc",
    },
    {
      content: buildCommitlintConfig(),
      path: "commitlint.config.js",
    },
    {
      content: buildPackageJson(config),
      path: "package.json",
    },
    {
      content: buildTsConfig(),
      path: "tsconfig.json",
    },
    {
      content: buildTsConfigBuild(),
      path: "tsconfig.build.json",
    },
    {
      content: buildVitestConfig(),
      path: "vitest.config.ts",
    },
    {
      content: buildLicense(config.license, config.author),
      path: "LICENSE",
    },
    {
      content: buildSourceIndex(),
      path: "source/index.ts",
    },
    {
      content: buildSourceTypes(),
      path: "source/types/index.ts",
    },
    {
      content: buildSourceFormatting(),
      path: "source/utils/formatting.ts",
    },
    {
      content: buildFormattingTest(),
      path: "test/utils/formatting.test.ts",
    },
    {
      content: buildHuskyCommitMsg(config.packageManager),
      executable: true,
      path: ".husky/commit-msg",
    },
  ];

  if (config.includeCli) {
    files.push({
      content: buildSourceCli(config.projectName),
      executable: true,
      path: "source/cli.ts",
    });
  }

  if (config.githubRepoUrl.length > 0) {
    files.push(
      {
        content: buildCiWorkflow(config),
        path: ".github/workflows/ci.yml",
      },
      {
        content: buildSemanticPrWorkflow(),
        path: ".github/workflows/semantic-pr.yml",
      },
    );
  }

  if (config.githubRepoUrl.length > 0 && config.includeReleasePlease) {
    files.push(
      {
        content: buildReleasePleaseWorkflow(config),
        path: ".github/workflows/release-please.yml",
      },
      {
        content: buildReleasePleaseConfig(config),
        path: "release-please-config.json",
      },
      {
        content: buildReleasePleaseManifest(),
        path: ".release-please-manifest.json",
      },
    );
  }

  return files;
};

const extractAuthorName = (author: string): string => {
  const match = /^(.*?)\s*</u.exec(author);
  if (match?.[1]?.trim().length) {
    return match[1].trim();
  }

  return author || "Unknown Author";
};
