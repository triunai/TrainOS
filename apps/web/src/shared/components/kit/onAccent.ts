/**
 * "Am I inside the blue record card?"
 *
 * The accent card (tightening brief §15a) puts a saturated blue under a whole
 * header: the title, the status chips and the three actions all sit on it. Every
 * one of those needs a different ink from the one it wears on a white card, and
 * none of them should have to be told twice.
 *
 * A CONTEXT rather than a prop on each, because the alternative is every screen
 * threading `onAccent` through every button and chip it puts in a header — and
 * the screen that forgets one gets an ink-coloured control invisible on blue,
 * which is a defect a reviewer has to catch by eye. Here the card provides it
 * once and the controls read it, so a screen's markup is identical whether its
 * header is accented or not. `CondensedPrimaryEcho` already establishes the
 * pattern in this kit.
 *
 * Kept in a `.ts` file with no component in it, so exporting the hook does not
 * cost the file its fast-refresh boundary.
 */

import { createContext, useContext } from "react";

const OnAccentContext = createContext(false);

export const OnAccentProvider = OnAccentContext.Provider;

/** True when the calling component is rendering on the accent card. */
export function useOnAccent(): boolean {
  return useContext(OnAccentContext);
}
