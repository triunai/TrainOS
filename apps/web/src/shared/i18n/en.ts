/**
 * The SHELL's strings, in English. Not the screens': translating those is a
 * later pass with a real catalogue and a real reviewer, and a half-translated
 * product reads worse than an untranslated one.
 *
 * This object's shape IS the key type — `ms.ts` has to satisfy it, so a key
 * added here without a Bahasa Malaysia string fails typecheck rather than
 * falling back silently at runtime.
 */
export const en = {
  "nav.group.main": "Main",
  "nav.group.operations": "Operations",
  "nav.group.knowledge": "Knowledge",
  "nav.group.finance": "Finance",
  "nav.group.admin": "Admin",

  "shell.search": "Search",
  "shell.notifications": "Notifications",
  "shell.help": "Help & support",
  "shell.shortcuts": "Shortcuts",
  "shell.role": "Role",
  "shell.roleDevOnly": "Role · development only",
  "shell.darkMode": "Dark mode",
  "shell.language": "Language",
  "shell.collapseSidebar": "Collapse the sidebar",
  "shell.expandSidebar": "Expand the sidebar",
  "shell.resetDemo": "Reset demo data",

  "demo.resetTitle": "Reset the demo data?",
  "demo.resetBody":
    "Every change made in this browser — decisions, edits, new records — is discarded and the demo dataset is restored. Nobody else's demo is affected.",
  "demo.resetConfirm": "Reset demo data",

  "help.documentation": "Documentation",
  "help.gettingStarted": "Getting started",
  "help.hrdc": "HRD Corp claims",
  "help.agents": "Agents and autonomy",
  "help.contact": "Contact",
  "help.hours": "Weekdays, 9am–6pm MYT",
  "help.problem": "Something wrong?",
  "help.report": "Report an issue",
  "help.reportHint": "Opens an email with the version and the page you are on already filled in.",

  "shortcuts.title": "Keyboard shortcuts",
  "shortcuts.subtitle": "⌘K opens the command palette from anywhere",
  "shortcuts.palette": "Open the command palette",
  "shortcuts.next": "Next item in a queue",
  "shortcuts.previous": "Previous item in a queue",
  "shortcuts.open": "Open the selected item",
  "shortcuts.drawer": "Open it in a drawer",
  "shortcuts.close": "Close the drawer or palette",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Readonly<Record<MessageKey, string>>;
