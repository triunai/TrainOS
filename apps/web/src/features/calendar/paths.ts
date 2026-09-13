/**
 * The calendar's path, derived from the navigation tree's one rule
 * (`shared/config/nav.ts`): a child of Training lives under `/training/`.
 *
 * Kept beside the screen rather than in the route file so a sibling can link
 * here without importing the route table, and so the two cannot disagree.
 */

export const CALENDAR_PATH = "/training/calendar";
