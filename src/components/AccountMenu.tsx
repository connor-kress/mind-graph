import { UserButton, useClerk, useUser } from "@clerk/react";

/** Clerk manages profile edits, account security, sessions, and sign-out. */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { user } = useUser();
  const { openUserProfile } = useClerk();
  if (!user) return null;
  const name = user.fullName?.trim() || user.username?.trim();
  const email = user.primaryEmailAddress?.emailAddress;
  const label = name || email || "Manage account";
  return (
    <div
      className={`flex items-center gap-2.5 ${compact ? "" : "mx-3 border-t border-neutral-200 py-4 pl-1"}`}
    >
      <UserButton />
      {!compact && (
        <button
          type="button"
          onClick={() => openUserProfile()}
          title="Manage account"
          aria-label={`Manage account for ${label}`}
          className="min-w-0 flex-1 cursor-pointer rounded-md text-left outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          <div className="truncate text-[13px] font-semibold">{label}</div>
          <div className="truncate text-xs text-neutral-500">
            {name && email ? email : "Manage account"}
          </div>
        </button>
      )}
    </div>
  );
}
