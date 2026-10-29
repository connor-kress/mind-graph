import { SignIn, useUser } from "@clerk/react";
import type { ReactNode } from "react";
import { Logo } from "./Logo";

/** Optional sign-in screen. Mount around content when it should require an account. */
export function AccountGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();

  if (isLoaded && isSignedIn) {
    return (
      <div key={user.id} className="h-full">
        {children}
      </div>
    );
  }

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 overflow-auto bg-neutral-50 p-6">
      <div className="flex items-center gap-2 text-xl font-bold">
        <Logo /> Mind Graph
      </div>
      {!isLoaded ? (
        <p role="status" className="text-sm text-neutral-500">
          Loading your account...
        </p>
      ) : (
        <>
          <p className="text-sm text-neutral-600">Sign in to build maps and practice recall.</p>
          <SignIn routing="hash" />
        </>
      )}
    </main>
  );
}
