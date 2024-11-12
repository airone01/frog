import {z} from 'zod';

export const zRegistryConfig = z.object({
  providers: z.array(z.string()), // List of usernames whose registries we trust
  defaultProvider: z.string().optional(), // Default provider to use when no provider specified
});

export const zPackageReference = z.object({
  provider: z.string(), // Username of the package provider
  name: z.string(), // Name of the package
});

export type RegistryConfig = z.infer<typeof zRegistryConfig>;
export type PackageReference = z.infer<typeof zPackageReference>;

// Function to parse package references like "elagouch:wireshark" or just "wireshark"
export function parsePackageReference(reference: string, defaultProvider?: string): PackageReference {
  const parts = reference.split(':');
  if (parts.length === 2) {
    return {provider: parts[0], name: parts[1]};
  }

  if (!defaultProvider) {
    throw new Error('No provider specified and no default provider configured');
  }

  return {provider: defaultProvider, name: reference};
}
