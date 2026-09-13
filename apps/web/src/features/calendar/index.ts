/**
 * The calendar feature's public surface.
 *
 * `.dependency-cruiser.cjs` makes reaching past this a build error rather than
 * a convention, so the route table and any sibling import from here only.
 */

export { TrainingCalendarScreen } from "./TrainingCalendarScreen";
export { CALENDAR_PATH } from "./paths";
export { daysWithin, openingAnchor, scheduleDays, todayKey, type ScheduleDay } from "./schedule";
