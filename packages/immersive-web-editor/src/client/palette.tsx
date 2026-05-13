// ⌘K palette. Thin wrapper over cmdk that renders the global command list.
// Keyboard: arrow keys to navigate, enter to run, esc to close. cmdk handles
// filtering automatically based on the <Command.Input> value.

import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useCommands } from './commands';
import { styles } from './styles';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Palette({ open, onOpenChange }: Props) {
  const commands = useCommands();
  const [query, setQuery] = useState('');

  // Reset the query when the palette closes so each open starts fresh.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={styles.paletteBackdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <Command
        className={styles.palette}
        label="Command palette"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onOpenChange(false);
        }}
      >
        <Command.Input
          className={styles.paletteInput}
          placeholder="Type a command…"
          value={query}
          onValueChange={setQuery}
          autoFocus
        />
        <Command.List className={styles.paletteList}>
          <Command.Empty className={styles.paletteEmpty}>No matching commands.</Command.Empty>
          {commands.map((c) => (
            <Command.Item
              key={c.id}
              value={`${c.title} ${c.id}`}
              className={styles.paletteItem}
              onSelect={() => {
                onOpenChange(false);
                void c.run();
              }}
            >
              <span className={styles.paletteItemTitle}>{c.title}</span>
              {c.hint && <kbd className={styles.paletteItemHint}>{c.hint}</kbd>}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
