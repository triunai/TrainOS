import { Link } from "react-router-dom";
import { ErrorState } from "@/shared/components/states";
import { DEFAULT_ROUTE_PATH } from "@/shared/config/nav";

export function NotFoundPage() {
  return (
    <ErrorState
      title="No such page"
      description="That URL does not match any route in the current navigation tree."
      action={
        <Link
          to={DEFAULT_ROUTE_PATH}
          className="rounded-control border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-hover"
        >
          Go to the dashboard
        </Link>
      }
    />
  );
}
