const npmRegistryUrl = "https://registry.npmjs.org/";
const registryRequestTimeoutMilliseconds = 3000;

type RegistryFetch = (url: string, init: RequestInit) => Promise<{ status: number }>;

export type NpmPackageNameAvailabilityStatus = "available" | "exists" | "unknown";

export interface NpmPackageNameAvailability {
  error?: string;
  packageName: string;
  status: NpmPackageNameAvailabilityStatus;
  statusCode?: number;
}

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
  const url = buildPackageMetadataUrl(packageName, options.registryUrl ?? npmRegistryUrl);
  const abortController = new AbortController();
  const timeoutId = setTimeout(
    () => abortController.abort(),
    options.timeoutMilliseconds ?? registryRequestTimeoutMilliseconds,
  );

  try {
    const response = await fetchPackage(url, {
      headers: {
        Accept: "application/json",
      },
      signal: abortController.signal,
    });

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
    clearTimeout(timeoutId);
  }
};

const buildPackageMetadataUrl = (packageName: string, registryUrl: string): string => {
  const baseUrl = registryUrl.endsWith("/") ? registryUrl : `${registryUrl}/`;

  return new URL(encodeURIComponent(packageName), baseUrl).toString();
};
