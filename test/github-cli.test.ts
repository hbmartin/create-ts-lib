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
      jsonOutput({ login: "hbmartin" }),
      jsonOutput({ html_url: "https://github.com/hbmartin/example-lib" }),
    ]);

    await expect(inspectPersonalGitHubRepository("example-lib", { executor })).resolves.toEqual({
      owner: "hbmartin",
      repositoryName: "example-lib",
      status: "found",
      url: "https://github.com/hbmartin/example-lib",
    });
    expect(executor).toHaveBeenNthCalledWith(1, ["api", "user"], {
      timeoutMilliseconds: 5000,
    });
    expect(executor).toHaveBeenNthCalledWith(2, ["api", "repos/hbmartin/example-lib"], {
      timeoutMilliseconds: 5000,
    });
  });

  it("reports a missing repository when GitHub returns HTTP 404", async () => {
    const executor = createExecutor([
      jsonOutput({ login: "hbmartin" }),
      commandFailure("not found", {
        stderr: "gh: Not Found (HTTP 404)",
        stdout: '{"message":"Not Found","status":"404"}',
      }),
    ]);

    await expect(inspectPersonalGitHubRepository("example-lib", { executor })).resolves.toEqual({
      owner: "hbmartin",
      predictedUrl: "https://github.com/hbmartin/example-lib",
      repositoryName: "example-lib",
      status: "missing",
    });
  });

  it("reports a missing repository when GitHub returns a JSON 404 status", async () => {
    const executor = createExecutor([
      jsonOutput({ login: "hbmartin" }),
      commandFailure("not found", {
        stdout: '{ "message": "Not Found", "status": "404" }',
      }),
    ]);

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
      reason: "gh api user returned an unexpected response",
      repositoryName: "example-lib",
      status: "unavailable",
    });
  });

  it("reports unavailable when repository lookup fails unexpectedly", async () => {
    const executor = createExecutor([
      jsonOutput({ login: "hbmartin" }),
      commandFailure("rate limit exceeded"),
    ]);

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

const commandFailure = (
  message: string,
  properties: { code?: number | string; stderr?: string; stdout?: string } = {},
): Error => Object.assign(new Error(message), { stderr: "", stdout: "", ...properties });
