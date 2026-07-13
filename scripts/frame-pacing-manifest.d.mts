export interface FileManifestEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface FileManifest {
  readonly treeSha256: string;
  readonly files: readonly FileManifestEntry[];
}

export function manifestPaths(paths: readonly string[]): Promise<FileManifest>;
export function manifestDirectory(directory: string): Promise<FileManifest>;
