import type { Messages } from "./en";

/**
 * Bahasa Malaysia, shell strings only.
 *
 * Typed as `Messages`, so this file cannot fall behind `en.ts`: a key added
 * there is a typecheck failure here until it is translated. That is the point
 * — a catalogue that is allowed to be incomplete becomes incomplete.
 *
 * Conventions followed here, for whoever extends it: Malaysian usage rather
 * than Indonesian ("anda", not "kamu"; "log masuk", not "masuk"), and product
 * nouns that are already English in the market stay English — HRD Corp is HRD
 * Corp, and nobody in a Malaysian L&D office says anything but "dashboard".
 */
export const ms: Messages = {
  "nav.group.main": "Utama",
  "nav.group.operations": "Operasi",
  "nav.group.knowledge": "Pengetahuan",
  "nav.group.finance": "Kewangan",
  "nav.group.admin": "Pentadbiran",

  "shell.search": "Cari",
  "shell.notifications": "Pemberitahuan",
  "shell.help": "Bantuan & sokongan",
  "shell.shortcuts": "Pintasan",
  "shell.role": "Peranan",
  "shell.roleDevOnly": "Peranan · pembangunan sahaja",
  "shell.darkMode": "Mod gelap",
  "shell.language": "Bahasa",
  "shell.collapseSidebar": "Kecilkan bar sisi",
  "shell.expandSidebar": "Besarkan bar sisi",

  "help.documentation": "Dokumentasi",
  "help.gettingStarted": "Panduan permulaan",
  "help.hrdc": "Tuntutan HRD Corp",
  "help.agents": "Ejen dan autonomi",
  "help.contact": "Hubungi kami",
  "help.hours": "Isnin hingga Jumaat, 9 pagi–6 petang MYT",
  "help.problem": "Ada masalah?",
  "help.report": "Laporkan isu",
  "help.reportHint":
    "Membuka e-mel dengan versi dan halaman yang anda berada di dalamnya sudah diisi.",

  "shortcuts.title": "Pintasan papan kekunci",
  "shortcuts.subtitle": "⌘K membuka palet arahan dari mana-mana",
  "shortcuts.palette": "Buka palet arahan",
  "shortcuts.next": "Item seterusnya dalam baris gilir",
  "shortcuts.previous": "Item sebelumnya dalam baris gilir",
  "shortcuts.open": "Buka item yang dipilih",
  "shortcuts.drawer": "Buka dalam laci",
  "shortcuts.close": "Tutup laci atau palet",
};
