interface PackageMetadata {
  readonly dependencies?: Readonly<Record<string, string>>;
}

export function linkedProductionDependencyNames(
  packageMetadata: PackageMetadata,
): string[];
export function framePacingSourcePaths(packageMetadata: PackageMetadata): string[];
