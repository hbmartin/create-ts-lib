const npmRegistryUrl = "https://registry.npmjs.org/";
const abbreviatedMetadataAcceptHeader = "application/vnd.npm.install-v1+json";
const registryRequestTimeoutMilliseconds = 3000;

type RegistryFetch = (url: string, init: RequestInit) => Promise<{ status: number }>;

interface NpmPackageNameAvailabilityBase {
  packageName: string;
}

export type NpmPackageNameAvailabilityUnknown =
  | (NpmPackageNameAvailabilityBase & {
      error: string;
      status: "unknown";
      statusCode?: never;
    })
  | (NpmPackageNameAvailabilityBase & {
      error?: never;
      status: "unknown";
      statusCode: number;
    });

export type NpmPackageNameAvailability =
  | (NpmPackageNameAvailabilityBase & { status: "available" })
  | (NpmPackageNameAvailabilityBase & { status: "exists" })
  | NpmPackageNameAvailabilityUnknown;

export type NpmPackageNameAvailabilityStatus = NpmPackageNameAvailability["status"];

export interface CheckNpmPackageNameAvailabilityOptions {
  fetch?: RegistryFetch;
  registryUrl?: string;
  timeoutMilliseconds?: number;
}

export const checkNpmPackageNameAvailability = async (
  packageName: string,
  options: CheckNpmPackageNameAvailabilityOptions = {},
): Promise<NpmPackageNameAvailability> => {
  const fetchPackage = options.fetch ?? fetch;
  const abortController = new AbortController();
  const timeoutMilliseconds = options.timeoutMilliseconds ?? registryRequestTimeoutMilliseconds;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      abortController.abort();
      reject(new Error("Request timed out"));
    }, timeoutMilliseconds);
  });

  try {
    const url = buildPackageMetadataUrl(packageName, options.registryUrl ?? npmRegistryUrl);
    const headResponse = await Promise.race([
      fetchPackage(url, {
        headers: {
          Accept: "application/json",
        },
        method: "HEAD",
        signal: abortController.signal,
      }),
      timeout,
    ]);
    const response = isHeadUnsupportedStatus(headResponse.status)
      ? await Promise.race([
          fetchPackage(url, {
            headers: {
              Accept: abbreviatedMetadataAcceptHeader,
            },
            method: "GET",
            signal: abortController.signal,
          }),
          timeout,
        ])
      : headResponse;

    if (response.status === 200) {
      return { packageName, status: "exists" };
    }

    if (response.status === 404) {
      return { packageName, status: "available" };
    }

    return { packageName, status: "unknown", statusCode: response.status };
  } catch (error) {
    const isAbortError = error instanceof Error && error.name === "AbortError";
    let errorMessage = "Unknown registry error";

    if (isAbortError) {
      errorMessage = "Request timed out";
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return {
      error: errorMessage,
      packageName,
      status: "unknown",
    };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
};

const buildPackageMetadataUrl = (packageName: string, registryUrl: string): string => {
  const baseUrl = registryUrl.endsWith("/") ? registryUrl : `${registryUrl}/`;

  return new URL(encodeURIComponent(packageName), baseUrl).toString();
};

const isHeadUnsupportedStatus = (status: number): boolean => status === 405 || status === 501;
