import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

export interface AppCommand {
  group: string;
  id: string;
  keywords?: string[];
  label: string;
  run: () => void;
  shortcut?: string;
}

interface CommandPaletteProps {
  commands: AppCommand[];
  isOpen: boolean;
  onClose: () => void;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

function matchesCommand(command: AppCommand, query: string) {
  if (!query) {
    return true;
  }
  const haystack = [command.label, command.group, ...(command.keywords ?? [])]
    .join(" ")
    .toLocaleLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function CommandPalettePanel({
  commands,
  onClose,
}: {
  commands: AppCommand[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const normalized = normalize(query);
    return commands.filter((command) => matchesCommand(command, normalized));
  }, [commands, query]);

  const grouped = useMemo(() => {
    const groups: { group: string; items: AppCommand[] }[] = [];
    for (const command of filtered) {
      const last = groups[groups.length - 1];
      if (last && last.group === command.group) {
        last.items.push(command);
      } else {
        groups.push({ group: command.group, items: [command] });
      }
    }
    return groups;
  }, [filtered]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(
      `[data-command-index="${activeIndex}"]`,
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, filtered.length]);

  const runCommand = (command: AppCommand) => {
    onClose();
    window.requestAnimationFrame(() => {
      command.run();
    });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!filtered.length) {
        return;
      }
      setActiveIndex((index) => (index + 1) % filtered.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!filtered.length) {
        return;
      }
      setActiveIndex(
        (index) => (index - 1 + filtered.length) % filtered.length,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[activeIndex];
      if (command) {
        runCommand(command);
      }
    }
  };

  let flatIndex = -1;

  return (
    <div
      aria-modal="true"
      className="command-palette-backdrop"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="dialog"
    >
      <div
        className="command-palette"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="command-palette__search">
          <input
            aria-label="搜索命令"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="输入命令名称或关键词…"
            ref={inputRef}
            value={query}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-palette__list" ref={listRef} role="listbox">
          {grouped.length === 0 ? (
            <div className="command-palette__empty">没有匹配的命令</div>
          ) : (
            grouped.map((section) => (
              <section key={section.group}>
                <h3>{section.group}</h3>
                {section.items.map((command) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  const isActive = index === activeIndex;
                  return (
                    <button
                      aria-selected={isActive}
                      className={
                        isActive
                          ? "command-palette__item is-active"
                          : "command-palette__item"
                      }
                      data-command-index={index}
                      key={command.id}
                      onClick={() => runCommand(command)}
                      onMouseEnter={() => setActiveIndex(index)}
                      role="option"
                      type="button"
                    >
                      <span>{command.label}</span>
                      {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>
        <div className="command-palette__footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            选择
          </span>
          <span>
            <kbd>Enter</kbd>
            执行
          </span>
          <span>
            <kbd>Esc</kbd>
            关闭
          </span>
        </div>
      </div>
    </div>
  );
}

export function CommandPalette({
  commands,
  isOpen,
  onClose,
}: CommandPaletteProps) {
  if (!isOpen) {
    return null;
  }

  return <CommandPalettePanel commands={commands} onClose={onClose} />;
}
