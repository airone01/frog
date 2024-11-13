import type {Package} from '../models/package';
import type {PackageReference} from '../models/package-reference';

export type PackageRepository = {
  findByName(name: string): Promise<Package | undefined>;
  findByReference(reference: PackageReference): Promise<Package | undefined>;
  save(package_: Package): Promise<void>;
  remove(name: string): Promise<void>;
  list(): Promise<Package[]>;
};
