export interface SshDirectoryListing {
  readonly path: string;
  readonly home: string;
  readonly parent: string | null;
  readonly directories: readonly string[];
  readonly truncated: boolean;
}
