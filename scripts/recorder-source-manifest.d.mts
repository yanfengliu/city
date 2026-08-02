export interface RecorderSourceFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface RecorderSourceManifest {
  readonly normalization: 'crlf-to-lf';
  readonly treeSha256: string;
  readonly files: readonly RecorderSourceFile[];
}

export const SOURCE_NORMALIZATION: 'crlf-to-lf';
export function canonicalTextBytes(bytes: Uint8Array): Uint8Array;
export function sourceFileRecord(path: string, bytes: Uint8Array): RecorderSourceFile;
export function finishSourceManifest(
  files: readonly RecorderSourceFile[],
): RecorderSourceManifest;
