import { encode, decode } from '@msgpack/msgpack';

// RPC Request types matching jaunt-protocol Rust crate
export type RpcRequest =
  | { SessionList: Record<string, never> }
  | { SessionCreate: { shell?: string | null; name?: string | null; cwd?: string | null } }
  | { SessionAttach: { target: string } }
  | { SessionDetach: Record<string, never> }
  | { SessionKill: { target: string } }
  | { SessionSend: { target: string; input: string } }
  | { SessionInfo: { target: string } }
  | { SessionRename: { target: string; new_name: string } }
  | { SessionPreview: { target: string; lines: number } }
  | { Resize: { cols: number; rows: number } }
  | { FileBrowse: { path: string; show_hidden: boolean } }
  | { FilePreview: { path: string; max_bytes: number } }
  | { FileDownload: { path: string } }
  | { FileUpload: { path: string; size: number } }
  | { FileDelete: { path: string } };

export interface SessionInfo {
  id: string;
  name: string | null;
  shell: string;
  cwd: string;
  state: string;
  fg_process: string | null;
  attached: number;
}

export interface DirEntry {
  name: string;
  entry_type: EntryType;
  size: number;
  modified: number;
  permissions: number;
  hidden: boolean;
}

export type EntryType =
  | 'File'
  | 'Directory'
  | { Symlink: { target: string } };

export type RpcData =
  | { SessionCreated: { id: string } }
  | { SessionList: SessionInfo[] }
  | { SessionInfo: SessionInfo }
  | { Output: string }
  | { DirListing: { path: string; entries: DirEntry[] } }
  | { FilePreview: { path: string; content: string; truncated: boolean } }
  | { FileReady: { size: number } }
  | 'Empty';

export type RpcResponse =
  | { Ok: RpcData }
  | { Error: { code: number; message: string } }
  | { SessionEvent: { event: string; session_id: string } };

export function encodeRequest(req: RpcRequest): Uint8Array {
  return encode(req) as Uint8Array;
}

export function decodeResponse(data: Uint8Array): RpcResponse {
  return decode(data) as RpcResponse;
}

// Helper to extract data from Ok response
export function unwrapOk(resp: RpcResponse): RpcData {
  if ('Ok' in resp) return resp.Ok;
  if ('Error' in resp) throw new Error(resp.Error.message);
  throw new Error('Unexpected response type');
}
