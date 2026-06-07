const npmRegistryUrl = "https://registry.npmjs.org/";

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
}

export const checkNpmPackageNameAvailability = async (
  packageName: string,
  options: CheckNpmPackageNameAvailabilityOptions = {},
): Promise<NpmPackageNameAvailability> => {
  const fetchPackage = options.fetch ?? fetch;
  const url = buildPackageMetadataUrl(packageName, options.registryUrl ?? npmRegistryUrl);

  try {
    const response = await fetchPackage(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 200) {
      return { packageName, status: "exists" };
    }

    if (response.status === 404) {
      return { packageName, status: "available" };
    }

    return { packageName, status: "unknown", statusCode: response.status };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown registry error",
      packageName,
      status: "unknown",
    };
  }
};

const buildPackageMetadataUrl = (packageName: string, registryUrl: string): string => {
  const baseUrl = registryUrl.endsWith("/") ? registryUrl : `${registryUrl}/`;

  return new URL(encodeURIComponent(packageName), baseUrl).toString();
};
