import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGitHubRepository,
  type GitHubCliCommandExecutor,
  getGitHubRepositoryName,
  inspectPersonalGitHubRepository,
} from "../source/github-cli.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("getGitHubRepositoryName", () => {
  it("strips npm scopes from repository names", () => {
    expect(getGitHubRepositoryName("@scope/example-lib")).toBe("example-lib");
    expect(getGitHubRepositoryName("plain-lib")).toBe("plain-lib");
  });
});

describe("inspectPersonalGitHubRepository", () => {
  it("reports an existing repository by authenticated user and project name", async () => {
    const executor = createExecutor([
      personalRepositoryLookupOutput("hbmartin", "https://github.com/hbmartin/example-lib"),
    ]);

    await expect(inspectPersonalGitHubRepository("example-lib", { executor })).resolves.toEqual({
      owner: "hbmartin",
      repositoryName: "example-lib",
      status: "found",
      url: "https://github.com/hbmartin/example-lib",
    });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith(
      expect.arrayContaining([
        "api",
        "graphql",
        "-f",
        expect.stringContaining("query PersonalRepositoryLookup"),
        "-f",
        "name=example-lib",
      ]),
      { timeoutMilliseconds: 5000 },
    );
  });

  it("passes numeric-looking repository names as raw GraphQL strings", async () => {
    const executor = createExecutor([
      personalRepositoryLookupOutput("hbmartin", "https://github.com/hbmartin/123"),
    ]);

    await expect(inspectPersonalGitHubRepository("@scope/123", { executor })).resolves.toEqual({
      owner: "hbmartin",
      repositoryName: "123",
      status: "found",
      url: "https://github.com/hbmartin/123",
    });
    expect(getFirstExecutorArgs(executor)).toEqual(expect.arrayContaining(["-f", "name=123"]));
    expect(getFirstExecutorArgs(executor)).not.toEqual(expect.arrayContaining(["-F", "name=123"]));
  });

  it("reports a missing repository when GraphQL returns no personal repository", async () => {
    const executor = createExecutor([personalRepositoryLookupOutput("hbmartin", null)]);

    await expect(inspectPersonalGitHubRepository("example-lib", { executor })).resolves.toEqual({
      owner: "hbmartin",
      predictedUrl: "https://github.com/hbmartin/example-lib",
      repositoryName: "example-lib",
      status: "missing",
    });
  });

  it("reports unavailable when gh api returns an unexpected JSON shape", async () => {
    const executor = createExecutor([jsonOutput({ id: 123 })]);

    await expect(inspectPersonalGitHubRepository("example-lib", { executor })).resolves.toEqual({
      reason: "gh api graphql returned an unexpected response",
      repositoryName: "example-lib",
      status: "unavailable",
    });
  });

  it("reports unavailable when repository lookup fails unexpectedly", async () => {
    const executor = createExecutor([commandFailure("rate limit exceeded")]);

    await expect(inspectPersonalGitHubRepository("example-lib", { executor })).resolves.toEqual({
      reason: "rate limit exceeded",
      repositoryName: "example-lib",
      status: "unavailable",
    });
  });

  it("reports unavailable when gh is missing", async () => {
    const executor = createExecutor([
      commandFailure("spawn gh ENOENT", {
        code: "ENOENT",
      }),
    ]);

    await expect(inspectPersonalGitHubRepository("example-lib", { executor })).resolves.toEqual({
      reason: "gh CLI is not installed or not on PATH",
      repositoryName: "example-lib",
      status: "unavailable",
    });
  });

  it("reports unavailable when gh requires authentication", async () => {
    const executor = createExecutor([
      commandFailure("authentication required", {
        code: 4,
      }),
    ]);

    await expect(inspectPersonalGitHubRepository("example-lib", { executor })).resolves.toEqual({
      reason: "gh CLI is not authenticated",
      repositoryName: "example-lib",
      status: "unavailable",
    });
  });

  it("reports unavailable when gh times out", async () => {
    vi.useFakeTimers();
    const executor = vi.fn(
      async () => new Promise<{ stderr: string; stdout: string }>(() => undefined),
    );
    const result = inspectPersonalGitHubRepository("example-lib", {
      executor,
      timeoutMilliseconds: 50,
    });

    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toEqual({
      reason: "gh command timed out after 50ms",
      repositoryName: "example-lib",
      status: "unavailable",
    });
  });

  it("reports unavailable when gh returns invalid JSON", async () => {
    const executor = createExecutor([{ stderr: "", stdout: "not json" }]);

    await expect(inspectPersonalGitHubRepository("example-lib", { executor })).resolves.toEqual({
      reason: "gh returned invalid JSON",
      repositoryName: "example-lib",
      status: "unavailable",
    });
  });
});

describe("createGitHubRepository", () => {
  it("creates a public repository with a non-empty description", async () => {
    const executor = createExecutor([
      { stderr: "", stdout: "https://github.com/hbmartin/demo-lib" },
    ]);

    await expect(
      createGitHubRepository(
        {
          description: "Demo library",
          owner: "hbmartin",
          repositoryName: "demo-lib",
        },
        { executor },
      ),
    ).resolves.toEqual({
      owner: "hbmartin",
      repositoryName: "demo-lib",
      status: "created",
      url: "https://github.com/hbmartin/demo-lib",
    });
    expect(executor).toHaveBeenCalledWith(
      ["repo", "create", "hbmartin/demo-lib", "--public", "--description", "Demo library"],
      { timeoutMilliseconds: 5000 },
    );
  });

  it("omits a blank repository description", async () => {
    const executor = createExecutor([{ stderr: "", stdout: "" }]);

    await createGitHubRepository(
      {
        description: "   ",
        owner: "hbmartin",
        repositoryName: "demo-lib",
      },
      { executor },
    );

    expect(executor).toHaveBeenCalledWith(["repo", "create", "hbmartin/demo-lib", "--public"], {
      timeoutMilliseconds: 5000,
    });
  });

  it("creates a private repository when requested", async () => {
    const executor = createExecutor([{ stderr: "", stdout: "" }]);

    await createGitHubRepository(
      {
        description: "",
        owner: "hbmartin",
        repositoryName: "demo-lib",
        visibility: "private",
      },
      { executor },
    );

    expect(executor).toHaveBeenCalledWith(["repo", "create", "hbmartin/demo-lib", "--private"], {
      timeoutMilliseconds: 5000,
    });
  });

  it("reports create failures without throwing", async () => {
    const executor = createExecutor([
      commandFailure("failed", {
        stderr: "repository already exists",
      }),
    ]);

    await expect(
      createGitHubRepository(
        {
          description: "Demo library",
          owner: "hbmartin",
          repositoryName: "demo-lib",
        },
        { executor },
      ),
    ).resolves.toEqual({
      owner: "hbmartin",
      reason: "repository already exists",
      repositoryName: "demo-lib",
      status: "failed",
      url: "https://github.com/hbmartin/demo-lib",
    });
  });

  it("sanitizes gh output in create failure reasons", async () => {
    const executor = createExecutor([
      commandFailure("failed", {
        stderr: "\u001B[31mrepository\r\nalready\u0007 exists\u001B[0m",
      }),
    ]);

    await expect(
      createGitHubRepository(
        {
          description: "Demo library",
          owner: "hbmartin",
          repositoryName: "demo-lib",
        },
        { executor },
      ),
    ).resolves.toEqual({
      owner: "hbmartin",
      reason: "repository already exists",
      repositoryName: "demo-lib",
      status: "failed",
      url: "https://github.com/hbmartin/demo-lib",
    });
  });

  it("reports non-error create failures without throwing", async () => {
    const executor = vi.fn(async () => {
      throw "failed";
    });

    await expect(
      createGitHubRepository(
        {
          description: "Demo library",
          owner: "hbmartin",
          repositoryName: "demo-lib",
        },
        { executor },
      ),
    ).resolves.toEqual({
      owner: "hbmartin",
      reason: "gh CLI failed",
      repositoryName: "demo-lib",
      status: "failed",
      url: "https://github.com/hbmartin/demo-lib",
    });
  });
});

const createExecutor = (
  responses: Array<Error | { stderr: string; stdout: string }>,
): GitHubCliCommandExecutor =>
  vi.fn(async () => {
    const response = responses.shift();

    if (!response) {
      throw new Error("Unexpected gh command");
    }

    if (response instanceof Error) {
      throw response;
    }

    return response;
  });

const jsonOutput = (value: unknown): { stderr: string; stdout: string } => ({
  stderr: "",
  stdout: JSON.stringify(value),
});

const personalRepositoryLookupOutput = (
  login: string,
  repositoryUrl: string | null,
): { stderr: string; stdout: string } =>
  jsonOutput({
    data: {
      viewer: {
        login,
        repository: repositoryUrl === null ? null : { url: repositoryUrl },
      },
    },
  });

const commandFailure = (
  message: string,
  properties: { code?: number | string; stderr?: string; stdout?: string } = {},
): Error => Object.assign(new Error(message), { stderr: "", stdout: "", ...properties });

const getFirstExecutorArgs = (executor: GitHubCliCommandExecutor): string[] => {
  const call = vi.mocked(executor).mock.calls[0];

  if (call === undefined) {
    throw new Error("Expected executor to be called");
  }

  return call[0];
};
