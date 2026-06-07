import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import { stripPackageScope } from "./name-helpers.js";

const execFileAsync = promisify(execFile);
const defaultTimeoutMilliseconds = 5000;
const maxBufferBytes = 1024 * 1024;
const gitHubNotFoundStatusRegex = /"status"\s*:\s*"404"/u;

interface GitHubCliCommandOutput {
  stderr: string;
  stdout: string;
}

export type GitHubCliCommandExecutor = (
  args: string[],
  options: { timeoutMilliseconds: number },
) => Promise<GitHubCliCommandOutput>;

export interface GitHubCliOptions {
  executor?: GitHubCliCommandExecutor;
  timeoutMilliseconds?: number;
}

export interface GitHubRepositoryTarget {
  owner: string;
  repositoryName: string;
  url: string;
}

export type GitHubRepositoryLookupResult =
  | ({ status: "found" } & GitHubRepositoryTarget)
  | ({ predictedUrl: string; status: "missing" } & Omit<GitHubRepositoryTarget, "url">)
  | {
      reason: string;
      repositoryName: string;
      status: "unavailable";
    };

export interface CreateGitHubRepositoryRequest {
  description: string;
  owner: string;
  repositoryName: string;
}

export type CreateGitHubRepositoryResult =
  | ({ status: "created" } & GitHubRepositoryTarget)
  | ({ reason: string; status: "failed" } & GitHubRepositoryTarget);

const gitHubUserSchema = z
  .object({
    login: z.string().min(1),
  })
  .passthrough();

const gitHubRepositorySchema = z
  .object({
    html_url: z.string().url(),
  })
  .passthrough();

export const getGitHubRepositoryName = (projectName: string): string =>
  stripPackageScope(projectName);

export const inspectPersonalGitHubRepository = async (
  projectName: string,
  options: GitHubCliOptions = {},
): Promise<GitHubRepositoryLookupResult> => {
  const repositoryName = getGitHubRepositoryName(projectName);

  try {
    const user = await runGitHubApiCommand("user", gitHubUserSchema, options);
    const owner = user.login;
    const predictedUrl = buildGitHubRepositoryUrl(owner, repositoryName);

    try {
      const repository = await runGitHubApiCommand(
        `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}`,
        gitHubRepositorySchema,
        options,
      );

      return {
        owner,
        repositoryName,
        status: "found",
        url: repository.html_url,
      };
    } catch (error) {
      if (isGitHubNotFoundError(error)) {
        return {
          owner,
          predictedUrl,
          repositoryName,
          status: "missing",
        };
      }

      return {
        reason: formatGitHubCliError(error),
        repositoryName,
        status: "unavailable",
      };
    }
  } catch (error) {
    return {
      reason: formatGitHubCliError(error),
      repositoryName,
      status: "unavailable",
    };
  }
};

export const createGitHubRepository = async (
  request: CreateGitHubRepositoryRequest,
  options: GitHubCliOptions = {},
): Promise<CreateGitHubRepositoryResult> => {
  const url = buildGitHubRepositoryUrl(request.owner, request.repositoryName);
  const args = ["repo", "create", `${request.owner}/${request.repositoryName}`, "--public"];
  const description = request.description.trim();

  if (description.length > 0) {
    args.push("--description", description);
  }

  try {
    await runGitHubCliCommand(args, options);

    return {
      owner: request.owner,
      repositoryName: request.repositoryName,
      status: "created",
      url,
    };
  } catch (error) {
    return {
      owner: request.owner,
      reason: formatGitHubCliError(error),
      repositoryName: request.repositoryName,
      status: "failed",
      url,
    };
  }
};

const runGitHubApiCommand = async <T>(
  endpoint: string,
  schema: z.ZodType<T>,
  options: GitHubCliOptions,
): Promise<T> => {
  const output = await runGitHubCliCommand(["api", endpoint], options);
  const parsedJson = parseJson(output.stdout);
  const parsedValue = schema.safeParse(parsedJson);

  if (!parsedValue.success) {
    throw new Error(`gh api ${endpoint} returned an unexpected response`);
  }

  return parsedValue.data;
};

const runGitHubCliCommand = async (
  args: string[],
  options: GitHubCliOptions,
): Promise<GitHubCliCommandOutput> => {
  const timeoutMilliseconds = options.timeoutMilliseconds ?? defaultTimeoutMilliseconds;
  const executor = options.executor ?? defaultGitHubCliCommandExecutor;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`gh command timed out after ${timeoutMilliseconds}ms`));
    }, timeoutMilliseconds);
  });

  try {
    return await Promise.race([executor(args, { timeoutMilliseconds }), timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
};

const defaultGitHubCliCommandExecutor: GitHubCliCommandExecutor = async (
  args,
  { timeoutMilliseconds },
) => {
  const { stderr, stdout } = await execFileAsync("gh", args, {
    maxBuffer: maxBufferBytes,
    timeout: timeoutMilliseconds,
  });

  return { stderr, stdout };
};

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("gh returned invalid JSON");
  }
};

const buildGitHubRepositoryUrl = (owner: string, repositoryName: string): string =>
  `https://github.com/${owner}/${repositoryName}`;

const isGitHubNotFoundError = (error: unknown): boolean => {
  const output = getErrorOutput(error);

  return output.includes("HTTP 404") || gitHubNotFoundStatusRegex.test(output);
};

const formatGitHubCliError = (error: unknown): string => {
  if (isErrorWithCode(error, "ENOENT")) {
    return "gh CLI is not installed or not on PATH";
  }

  if (isErrorWithCode(error, 4)) {
    return "gh CLI is not authenticated";
  }

  if (error instanceof Error) {
    const output = getErrorOutput(error).trim();

    return output.length > 0 ? output : error.message;
  }

  return "gh CLI failed";
};

const getErrorOutput = (error: unknown): string => {
  if (!isErrorWithOutput(error)) {
    return "";
  }

  return [error.stderr, error.stdout].filter((value) => value.length > 0).join("\n");
};

const isErrorWithCode = (error: unknown, code: number | string): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === code;

const isErrorWithOutput = (error: unknown): error is Error & { stderr: string; stdout: string } =>
  error instanceof Error &&
  "stderr" in error &&
  typeof error.stderr === "string" &&
  "stdout" in error &&
  typeof error.stdout === "string";
