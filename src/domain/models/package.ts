export type Package = {
  name: string;
  version: string;
  provider?: string;
  binaries: string[];
  installScript?: string;
  url?: string;
};
