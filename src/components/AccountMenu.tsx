import { useClerk, useUser } from "@clerk/react";
import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/** Clerk owns profile details, security, and sessions. */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { user } = useUser();
  const { openUserProfile, signOut } = useClerk();
  if (!user) return null;
  const name = user.fullName?.trim() || user.username?.trim();
  const email = user.primaryEmailAddress?.emailAddress;
  const label = name || email || "Manage account";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={
            compact
              ? "size-9 rounded-lg p-1"
              : "h-auto w-full justify-start gap-3 px-2 py-2.5 text-left"
          }
          aria-label={`Account menu for ${label}`}
        >
          <Avatar className="size-8 rounded-lg">
            <AvatarImage src={user.imageUrl} alt="" />
            <AvatarFallback>{label.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          {!compact && (
            <>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-medium">{label}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {name && email ? email : "Manage account"}
                </span>
              </span>
              <ChevronsUpDown className="size-4 text-muted-foreground" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={compact ? "bottom" : "top"}
        align="end"
        className="w-64"
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DropdownMenuLabel className="truncate">{email || label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openUserProfile()}>
          <Settings />
          Account settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut({ redirectUrl: "/" })}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
