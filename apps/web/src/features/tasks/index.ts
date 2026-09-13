/**
 * The tasks feature's ONLY public surface (CLAUDE.md R5).
 *
 * `/my-tasks` and the path the route table mounts it at. The three reads it
 * merges, the bucketing rule and the row shape are private — a sibling that
 * wants a task list wants this screen, not its internals.
 */

export { MyTasksScreen } from "./MyTasksScreen";
export { MY_TASKS_PATH } from "./paths";
