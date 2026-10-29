import { SignIn, useUser } from "@clerk/react";
import { useConvexAuth } from "convex/react";
import { BookOpen, Brain, GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { AccountMenu } from "./AccountMenu";
import { Logo } from "./Logo";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

/** Wait for Convex to verify the Clerk session before subscribing to private data. */
export function AccountGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoaded && isSignedIn && isAuthenticated)
    return (
      <div key={user.id} className="h-full">
        {children}
      </div>
    );
  return (
    <main className="grid min-h-full bg-background lg:grid-cols-2">
      <section className="flex flex-col justify-between border-b bg-sidebar p-6 lg:border-r lg:border-b-0 lg:p-12">
        <div className="flex items-center gap-3 text-sm font-semibold">
          <Logo className="size-7" />
          Mind Graph
        </div>
        <div className="mx-auto hidden w-full max-w-md py-16 lg:block">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Connect ideas.
            <br />
            Remember more.
          </h1>
          <p className="mt-5 max-w-sm text-base leading-7 text-muted-foreground">
            Turn your notes into a map, then see how much you can rebuild from memory.
          </p>
          <div className="mt-10 space-y-5">
            {[
              {
                icon: GitBranch,
                title: "Build your understanding",
                text: "Connect concepts in a reference map.",
              },
              {
                icon: Brain,
                title: "Practice from memory",
                text: "Rebuild it with your notes tucked away.",
              },
              {
                icon: BookOpen,
                title: "See what you missed",
                text: "Compare your maps and fill in the gaps.",
              },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                  <Icon className="size-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-medium">{title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="hidden text-xs text-muted-foreground lg:block">
          Your maps and notes belong to your private library.
        </p>
      </section>
      <section className="flex min-w-0 flex-col items-center justify-center gap-6 px-4 py-10 sm:px-8">
        {!isLoaded || (isSignedIn && isLoading) ? (
          <div role="status" className="w-full max-w-xs space-y-4">
            <p className="text-center text-sm text-muted-foreground">Loading your account...</p>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isSignedIn ? (
          <div role="alert" className="w-full max-w-sm space-y-5 rounded-xl border p-6">
            <h1 className="font-semibold">Couldn't connect your account</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Try reloading or signing in again.
            </p>
            <Button onClick={() => location.reload()}>Reload</Button>
            <AccountMenu />
          </div>
        ) : (
          <>
            <div className="max-w-sm text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Welcome to Mind Graph</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Sign in or create an account to get started.
              </p>
            </div>
            <SignIn routing="hash" withSignUp />
          </>
        )}
      </section>
    </main>
  );
}
