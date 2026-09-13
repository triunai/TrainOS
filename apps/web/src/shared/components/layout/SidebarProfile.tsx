import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { Avatar, ProfileModal } from "@/shared/components/kit";
import { FOCUS_RING } from "@/shared/components/kit/tokens";
import { ROLE_LABEL } from "@/shared/config/roles";
import {
  FIXTURE_PROFILE_DETAILS,
  orgAndLocation,
  profileChips,
  scopeLabels,
} from "@/shared/config/profileDetails";
import { useMe } from "@/shared/hooks/useMe";
import { ThemeSwitch } from "./ThemeSwitch";
import { VERSION_LINE } from "./version";

/**
 * Who you are, at the TOP of the rail, under the wordmark.
 *
 * It sat in the footer until a reader pointed out that identity is the first
 * thing you check and the last place you look for it. The wordmark says which
 * product; the row under it says which person and which tenant, which is the
 * question someone actually has when they open a shared machine.
 *
 * The row opens the profile modal. The theme switch sits beside it rather than
 * inside it, because changing the theme is a thing people do often and opening
 * a modal to do it is a tax on the common case.
 *
 * Every value the modal shows that the API does not return comes from
 * `shared/config/profileDetails.ts`, where it is marked as invented.
 */
export function SidebarProfile() {
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const details = FIXTURE_PROFILE_DETAILS;

  return (
    <div className="flex items-center gap-1.5 pb-4 pt-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-control px-2 py-1.5 text-left hover:bg-surface-hover",
          FOCUS_RING,
        )}
      >
        <Avatar name={me.name} size={26} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{me.name}</span>
          <span className="block truncate text-[11px] text-ink-muted">{ROLE_LABEL[me.role]}</span>
        </span>
      </button>

      <ThemeSwitch />

      <ProfileModal
        open={open}
        onClose={() => setOpen(false)}
        name={me.name}
        roleLabel={ROLE_LABEL[me.role]}
        orgAndLocation={orgAndLocation(details)}
        lastSignIn={`Last sign in ${details.lastSignIn}`}
        session={details.session}
        version={VERSION_LINE}
        orgName={details.orgName}
        orgCode={details.orgCode}
        chips={profileChips(details)}
        dataScope={scopeLabels(me)}
        fields={[
          { label: "Job title", value: details.jobTitle },
          { label: "Department", value: details.department },
          { label: "Email", value: details.email },
          { label: "Mobile", value: details.mobile },
          { label: "Staff no.", value: details.staffNumber },
          /* The pack draws this one as "Coming soon" and so does this: `Me`
             carries a locale and a timezone, but nothing can change them yet,
             and a control that cannot act is worse than an honest label. */
          { label: "Language & timezone", value: "Coming soon", pending: true },
        ]}
      />
    </div>
  );
}
