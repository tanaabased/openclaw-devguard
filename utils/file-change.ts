export type FileChangeEventName = 'add' | 'change' | 'unlink';

export interface FileSignature {
  contentHash: string;
  statKey: string;
}

export interface FileChangeInput {
  event: FileChangeEventName;
  initialized: boolean;
  next?: FileSignature;
  previous?: FileSignature;
}

export default function shouldReportFileChange(input: FileChangeInput): boolean {
  if (!input.initialized) return false;
  if (input.event === 'unlink') return input.previous !== undefined;
  if (!input.next) return false;
  if (!input.previous) return true;
  return input.previous.contentHash !== input.next.contentHash;
}
