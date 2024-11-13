export type SourceType = 'local' | 'provider' | 'remote';

export type PackageSource = {
  type: SourceType;
  location: string;
  provider?: string;
};
