import { SignIn, useUser } from "@clerk/react";
import { useConvexAuth } from "convex/react";
import type { ReactNode } from "react";
import { AccountMenu } from "./AccountMenu";
import { Logo } from "./Logo";

/** Wait for Convex to verify the Clerk session before mounting data subscriptions. */
export function AccountGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoaded && isSignedIn && isAuthenticated) {
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
      {!isLoaded || (isSignedIn && isLoading) ? (
        <p role="status" className="text-sm text-neutral-500">
          Loading your account...
        </p>
      ) : isSignedIn ? (
        <div role="alert" className="max-w-sm space-y-4 text-center">
          <p>We couldn't connect your account. Try reloading or signing in again.</p>
          <button
            type="button"
            onClick={() => location.reload()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-white"
          >
            Reload
          </button>
          <AccountMenu />
        </div>
      ) : (
        <>
          <p className="text-sm text-neutral-600">
            Sign in or create an account to build maps and practice recall.
          </p>
          <SignIn routing="hash" withSignUp />
        </>
      )}
    </main>
  );
}
