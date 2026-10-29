import { ClerkProvider } from "@clerk/react";
import type { ReactNode } from "react";

export function AccountProvider({ children }: { children: ReactNode }) {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  if (!publishableKey) throw new Error("Set VITE_CLERK_PUBLISHABLE_KEY in .env.local");

  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      {children}
    </ClerkProvider>
  );
}
