import type { Adapter, Session } from './index.js';
export interface GridOptions {
  adapter?: Adapter;
  readOnly?: boolean;
  storageKey?: string;
  pollInterval?: number;
}
export interface SavedGrid {
  id: string;
  name: string;
  sessionIds: string[];
}
export class AgentGridElement extends HTMLElement {
  adapter: Adapter | null;
  readOnly: boolean;
  readonly activeGrid: string;
  readonly savedGrids: SavedGrid[];
  saveGrid(name: string, sessionIds?: string[]): string;
  selectGrid(id: string): void;
  deleteGrid(id: string): void;
  refresh(): Promise<void>;
}
export function defineAgentGrid(tagName?: string): void;
export function mountAgentGrid(container: HTMLElement, options?: GridOptions): { element: AgentGridElement; destroy(): void };
declare global {
  interface HTMLElementTagNameMap { 'agent-grid': AgentGridElement }
  interface HTMLElementEventMap {
    'agent-grid-error': CustomEvent<{ message: string }>;
    'agent-grid-action': CustomEvent<{ sessionId: string; action: string }>;
    'agent-grid-view-change': CustomEvent<{ gridId: string; sessionIds: string[] | null }>;
  }
}
