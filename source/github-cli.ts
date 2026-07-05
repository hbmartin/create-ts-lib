import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import { isErrorWithCode } from "./filesystem-errors.js";
import { stripPackageScope } from "./name-helpers.js";

const execFileAsync = promisify(execFile);
const defaultTimeoutMilliseconds = 5000;
const maxBufferBytes = 1024 * 1024;

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

export type GitHubRepositoryVisibility = "private" | "public";

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
  visibility?: GitHubRepositoryVisibility;
}

export type CreateGitHubRepositoryResult =
  | ({ status: "created" } & GitHubRepositoryTarget)
  | ({ reason: string; status: "failed" } & GitHubRepositoryTarget);

const gitHubPersonalRepositoryLookupQuery = `query PersonalRepositoryLookup($name: String!) {
  viewer {
    login
    repository(name: $name) {
      url
    }
  }
}`;

const gitHubPersonalRepositoryLookupSchema = z.object({
  data: z.object({
    viewer: z.object({
      login: z.string().min(1),
      repository: z
        .object({
          url: z.url(),
        })
        .nullable(),
    }),
  }),
});

export const getGitHubRepositoryName = (projectName: string): string =>
  stripPackageScope(projectName);

export const inspectPersonalGitHubRepository = async (
  projectName: string,
  options: GitHubCliOptions = {},
): Promise<GitHubRepositoryLookupResult> => {
  const repositoryName = getGitHubRepositoryName(projectName);

  try {
    const lookup = await runGitHubGraphQlCommand(
      gitHubPersonalRepositoryLookupQuery,
      { name: repositoryName },
      gitHubPersonalRepositoryLookupSchema,
      options,
    );
    const owner = lookup.data.viewer.login;
    const predictedUrl = buildGitHubRepositoryUrl(owner, repositoryName);
    const repository = lookup.data.viewer.repository;

    if (repository === null) {
      return {
        owner,
        predictedUrl,
        repositoryName,
        status: "missing",
      };
    }

    return {
      owner,
      repositoryName,
      status: "found",
      url: repository.url,
    };
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
  const visibility = request.visibility ?? "public";
  const args = ["repo", "create", `${request.owner}/${request.repositoryName}`, `--${visibility}`];
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

const runGitHubGraphQlCommand = async <T>(
  query: string,
  fields: Record<string, string>,
  schema: z.ZodType<T>,
  options: GitHubCliOptions,
): Promise<T> => {
  const args = ["api", "graphql", "-f", `query=${query}`];

  for (const [name, value] of Object.entries(fields)) {
    args.push("-f", `${name}=${value}`);
  }

  const output = await runGitHubCliCommand(args, options);
  const parsedJson = parseJson(output.stdout);
  const parsedValue = schema.safeParse(parsedJson);

  if (!parsedValue.success) {
    throw new Error("gh api graphql returned an unexpected response");
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

const maxGitHubCliErrorLength = 500;

const formatGitHubCliError = (error: unknown): string => {
  if (isErrorWithCode(error, "ENOENT")) {
    return "gh CLI is not installed or not on PATH";
  }

  if (isErrorWithCode(error, 4)) {
    return "gh CLI is not authenticated";
  }

  if (error instanceof Error) {
    const output = formatGitHubCliDiagnostic(getErrorOutput(error));

    if (output.length > 0) {
      return output;
    }

    const message = formatGitHubCliDiagnostic(error.message);
    return message.length > 0 ? message : "gh CLI failed";
  }

  return "gh CLI failed";
};

const getErrorOutput = (error: unknown): string => {
  if (!isErrorWithOutput(error)) {
    return "";
  }

  return [error.stderr, error.stdout].filter((value) => value.length > 0).join("\n");
};

const formatGitHubCliDiagnostic = (value: string): string => {
  const cleaned = Array.from(stripAnsiEscapeSequences(value), stripControlCharacter)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= maxGitHubCliErrorLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxGitHubCliErrorLength - 3).trimEnd()}...`;
};

const escapeCharacterCode = 27;

const stripAnsiEscapeSequences = (value: string): string => {
  let result = "";

  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== escapeCharacterCode) {
      result += value[index];
      continue;
    }

    if (value[index + 1] !== "[") {
      continue;
    }

    index += 2;
    while (index < value.length) {
      const charCode = value.charCodeAt(index);

      if (charCode >= 0x40 && charCode <= 0x7e) {
        break;
      }

      index += 1;
    }
  }

  return result;
};

const stripControlCharacter = (character: string): string => {
  const charCode = character.charCodeAt(0);

  return charCode === 127 || (charCode < 32 && !isWhitespaceControlCharacter(charCode))
    ? ""
    : character;
};

const isWhitespaceControlCharacter = (charCode: number): boolean =>
  charCode === 9 || charCode === 10 || charCode === 13;

const isErrorWithOutput = (error: unknown): error is Error & { stderr: string; stdout: string } =>
  error instanceof Error &&
  "stderr" in error &&
  typeof error.stderr === "string" &&
  "stdout" in error &&
  typeof error.stdout === "string";
