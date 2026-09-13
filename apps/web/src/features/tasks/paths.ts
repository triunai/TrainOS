import { navPath } from "@/shared/config/nav";

/**
 * The feature's route path, derived from the nav tree's own rule.
 *
 * "My tasks" is a child of `Home`, and `navPath` puts a child of Home at the
 * root — so this is `/my-tasks`, not `/home/my-tasks`. Deriving it rather than
 * writing the string is what stops the rail and the route table disagreeing
 * when a label changes.
 */

/** `/my-tasks` — the human's own queue. */
export const MY_TASKS_PATH = navPath("Home", "My tasks");
