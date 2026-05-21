// Editor-wide command registry. Single source of truth for everything
// surfaced by ⌘K and the per-tab `…` menus. The iframe's SDK also registers
// into this (via the bridge) and its entries get cleared on iframe reload.

import { useEffect, useState } from 'react';

export interface Command {
  id: string;
  title: string;
  run: () => void | Promise<void>;
  hint?: string;
  keybinding?: string; // "mod+k", "shift+/", …
  scope?: string;      // when set, the command only surfaces in that slot's `...`
  source?: Window;     // set by the bridge when registered from an iframe
}

const commands = new Map<string, Command>();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function register(cmd: Command): () => void {
  commands.set(cmd.id, cmd);
  emit();
  return () => unregister(cmd.id);
}

export function unregister(id: string): void {
  if (commands.delete(id)) emit();
}

export function clearBySource(source: Window): void {
  let touched = false;
  for (const [id, c] of commands) {
    if (c.source === source) {
      commands.delete(id);
      touched = true;
    }
  }
  if (touched) emit();
}

export function list(scope?: string): Command[] {
  const all = [...commands.values()];
  if (scope === undefined) {
    // Palette view — hide scope-only commands so they don't leak out of their tab.
    return all.filter((c) => !c.scope);
  }
  // Per-tab `...` — commands scoped to this tab, plus unscoped (global) commands.
  return all.filter((c) => c.scope === scope || !c.scope);
}

export function getById(id: string): Command | undefined {
  return commands.get(id);
}

export function useCommands(scope?: string): Command[] {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return list(scope);
}

// Simple keybinding parser: "mod+k", "mod+shift+p". mod = meta on mac, ctrl elsewhere.
function matches(e: KeyboardEvent, binding: string): boolean {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const parts = binding.toLowerCase().split('+');
  const key = parts.pop()!;
  const want = new Set(parts);
  const modWanted = want.has('mod');
  const modMatch = modWanted ? (isMac ? e.metaKey : e.ctrlKey) : !e.metaKey && !e.ctrlKey;
  const shiftMatch = want.has('shift') ? e.shiftKey : !e.shiftKey;
  const altMatch = want.has('alt') ? e.altKey : !e.altKey;
  return modMatch && shiftMatch && altMatch && e.key.toLowerCase() === key;
}

export function useKeybindings(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const c of commands.values()) {
        if (c.keybinding && matches(e, c.keybinding)) {
          e.preventDefault();
          e.stopPropagation();
          void c.run();
          return;
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
