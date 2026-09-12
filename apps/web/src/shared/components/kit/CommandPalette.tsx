import { useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { SearchResult } from "@trainos/contract";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import { cn } from "@/shared/lib/utils";
import { KeyboardShortcut } from "./KeyboardShortcut";
import { RefChip } from "./RefChip";
import { AI_GLYPH } from "./tokens";

/**
 * The ⌘K command palette. Kit.dc.html §05.
 *
 * Records first, then actions — the artboard's order, and the right one: most
 * ⌘K presses are someone trying to get somewhere, not trying to do something.
 * Each record row carries its typed three-letter tag so a mixed list stays
 * scannable, and an AI row is marked with the glyph and the word, never a fill.
 *
 * Composed from the scaffold's `ui/command` primitives (cmdk) inside a Radix
 * dialog positioned per the pack — the palette sits near the top of the
 * viewport rather than centred, because a list that grows downward from a fixed
 * point does not move the input under the user's fingers. The scaffold's own
 * `CommandDialog` centres it, which is why the dialog is assembled here.
 *
 * This is the shell only. It takes a `SearchResult` and hands back what was
 * chosen — it does not fetch, and it does not know what any result means.
 */

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** `GET /v1/search`. Undefined while loading. */
  results?: SearchResult;
  onSelectRecord?: (path: string) => void;
  onSelectAction?: (type: string) => void;
  /** The ✦ row: "Ask TrainOS about…". */
  onAsk?: (query: string) => void;
  loading?: boolean;
  className?: string;
}

const HEADING =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-ink-muted";

export function CommandPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  results,
  onSelectRecord,
  onSelectAction,
  onAsk,
  loading,
  className,
}: CommandPaletteProps) {
  /* ⌘K and Ctrl+K open it from anywhere. Registered here rather than in the top
     bar so the binding exists even on a screen with no top bar. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const rowClass =
    "flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2 text-[13px] text-ink data-[selected=true]:bg-ai-tint-2 data-[selected=true]:text-primary-hover";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/25 data-[state=open]:animate-in data-[state=open]:fade-in-0" />

        <Dialog.Content
          aria-label="Search TrainOS"
          className={cn(
            "fixed left-1/2 top-[15vh] z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-card-lg border border-border bg-card shadow-raised outline-none",
            className,
          )}
        >
          <Dialog.Title className="sr-only">Search TrainOS</Dialog.Title>

          {/* cmdk filters on its own by default; the server has already
              filtered, so turning it off keeps the two from disagreeing. */}
          <Command shouldFilter={false} className={cn("bg-card", HEADING)}>
            <CommandInput
              value={query}
              onValueChange={onQueryChange}
              placeholder="Search records and actions"
              className="text-[14px] text-ink placeholder:text-ink-muted"
            />

            <CommandList className="max-h-[min(420px,50vh)] p-2">
              {loading ? (
                <div className="px-2.5 py-6 text-center text-[13px] text-ink-muted">Searching…</div>
              ) : null}

              {!loading &&
              results &&
              results.records.length === 0 &&
              results.actions.length === 0 ? (
                <CommandEmpty className="px-2.5 py-6 text-center text-[13px] text-ink-muted">
                  Nothing matches “{query}”.
                </CommandEmpty>
              ) : null}

              {results && results.records.length > 0 ? (
                <CommandGroup heading="Records">
                  {results.records.map((record) => (
                    <CommandItem
                      key={record.ref}
                      value={record.ref}
                      onSelect={() => onSelectRecord?.(record.path)}
                      className={rowClass}
                    >
                      <RefChip type={record.type} />
                      <span className="min-w-0 flex-1 truncate">{record.title}</span>
                      {record.subtitle ? (
                        <span className="shrink-0 truncate text-[12px] text-ink-muted">
                          {record.subtitle}
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {results && results.actions.length > 0 ? (
                <CommandGroup heading="Actions">
                  {results.actions.map((action) => (
                    <CommandItem
                      key={`${action.type}-${action.targetRef}`}
                      value={`${action.type} ${action.label}`}
                      onSelect={() => onSelectAction?.(action.type)}
                      className={rowClass}
                    >
                      <span className="min-w-0 flex-1 truncate">{action.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-muted">
                        {action.targetRef}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {onAsk && query ? (
                <CommandItem
                  value={`ask ${query}`}
                  onSelect={() => onAsk(query)}
                  className={cn(rowClass, "mt-1 border-t border-divider pt-2.5")}
                >
                  <span aria-hidden="true" className="text-primary-hover">
                    {AI_GLYPH}
                  </span>
                  <span className="min-w-0 flex-1 truncate">Ask TrainOS about “{query}”</span>
                  <span className="shrink-0 rounded-pill border border-primary-border bg-ai-tint px-1.5 py-px font-mono text-[10px] text-primary-hover">
                    AI
                  </span>
                </CommandItem>
              ) : null}
            </CommandList>
          </Command>

          <footer className="flex flex-wrap items-center gap-3 border-t border-divider bg-surface px-3 py-2">
            <KeyboardShortcut keys={["↑", "↓"]} action="navigate" />
            <KeyboardShortcut keys={["↵"]} action="open" />
            <KeyboardShortcut keys={["⌘", "↵"]} action="open in drawer" />
            <KeyboardShortcut keys={["esc"]} action="close" />
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
