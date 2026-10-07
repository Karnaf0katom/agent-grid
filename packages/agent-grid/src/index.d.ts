export type SessionStatus = 'running' | 'waiting' | 'starting' | 'error' | 'queued' | 'idle' | 'stopped';
export interface Session {
  id: string;
  title: string;
  group?: string;
  tool?: string;
  status?: SessionStatus;
  needsYou?: boolean;
  question?: string;
  detail?: string;
  capabilities?: { send?: boolean; interrupt?: boolean; open?: boolean };
}
export interface RequestOptions { signal?: AbortSignal }
export interface Output { text: string; mode?: 'snapshot' }
export interface Adapter {
  listSessions(options?: RequestOptions): Promise<Session[]>;
  readOutput?(id: string, options?: RequestOptions): Promise<Output | string>;
  sendPrompt?(id: string, text: string, options?: RequestOptions): Promise<unknown>;
  performAction?(id: string, action: 'interrupt', options?: RequestOptions): Promise<unknown>;
  openSession?(id: string): void;
  mountSession?(container: HTMLElement, session: Session, options: RequestOptions): void | (() => void);
  subscribe?(listener: () => void): () => void;
}
export function normalizeSessions(value: Session[] | { sessions: Session[] }): Session[];
export function createHttpAdapter(options?: { baseUrl?: string; fetch?: typeof fetch; readOnly?: boolean }): Adapter;
export interface MemoryAdapter extends Adapter {
  update(sessions: Session[]): void;
  setOutput(id: string, text: string): void;
}
export function createMemoryAdapter(sessions: Session[], output?: Record<string, string>): MemoryAdapter;
export const ACTIVE_STATUSES: Set<SessionStatus>;
export function attentionRank(session: Session): number;
export function mergeTileOrder(sessions: Session[], savedIds?: string[]): Session[];
export function insertTileOrder(ids: string[], sourceId: string, targetId: string, position?: 'before' | 'after'): string[];
export function resizeGridTracks(tracks: number[], index: number, deltaPx: number, beforePx: number, afterPx: number, minPx?: number): number[];
export function tileColumns(count: number, width?: number, minWidth?: number): number;
export function layoutKey(group: string, ids: string[], columns: number): string;
export function validTracks(value: unknown, count: number): boolean;
export function createLayoutStore(storage?: Storage | null, namespace?: string): { read(): Record<string, unknown>; write(value: unknown): void };
