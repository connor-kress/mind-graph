import { UserButton, useUser } from "@clerk/react";

/** Clerk manages profile edits, account security, sessions, and sign-out. */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { user } = useUser();
  if (!user) return null;
  return (
    <div
      className={`flex items-center gap-2.5 ${compact ? "" : "mx-3 border-t border-neutral-200 py-4 pl-1"}`}
    >
      <UserButton />
      {!compact && (
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-[13px] font-semibold">
            {user?.fullName || user?.username || "Your account"}
          </div>
          <div className="truncate text-xs text-neutral-500">
            {user?.primaryEmailAddress?.emailAddress}
          </div>
        </div>
      )}
    </div>
  );
}
