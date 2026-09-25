/**
 * Theme constants, server-safe. They live outside ThemeSwitch.tsx because a
 * "use client" module may export only components: a string imported from one
 * into the server root layout arrives as a client reference, not a string.
 */
export const THEME_KEY = "tpms.theme";

/** Runs before paint so a reload does not flash the wrong theme. */
export const THEME_BOOTSTRAP = `try{var t=localStorage.getItem('${THEME_KEY}');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}`;
