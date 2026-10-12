import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/context/AuthContext";
import type { AuthUser } from "@/types/user";

const HOME_PATH = "/";
const MODULES_PATH = "/modules";

const APPROVED_ONLY_PATHS = [
  "/modules",
  "/forum",
  "/surveys",
  "/resources",
  "/profile",
];

/** Where to go after logging in: the program, or home while the account awaits approval. */
export function landingPathFor(user: Pick<AuthUser, "is_approved">) {
  return user.is_approved === true ? MODULES_PATH : HOME_PATH;
}

function matchesPath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function ApprovalGate({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  // True once we've done the "approved user lands on home -> send to /modules"
  // check for this login session, so clicking Home later actually goes home.
  const hasHandledLandingRedirect = useRef(false);

  const isApproved = user?.is_approved === true;
  const isPending = !!user && user.is_approved === false;

  const isApprovedOnlyPage = APPROVED_ONLY_PATHS.some((path) =>
    matchesPath(router.pathname, path)
  );

  const isHomePage =
    router.pathname === HOME_PATH || router.pathname === "/";

  useEffect(() => {
    if (isLoading || !router.isReady) return;

    // Logged out: reset so the next login gets the landing redirect again.
    if (!user) {
      hasHandledLandingRedirect.current = false;
      return;
    }

    const alreadyHandled = hasHandledLandingRedirect.current;
    hasHandledLandingRedirect.current = true;

    // Pending users cannot access approved-only pages.
    if (isPending && isApprovedOnlyPage) {
      router.replace(HOME_PATH);
      return;
    }

    // Approved users who land on home (first load or right after login) go to
    // /modules. After that, they can navigate to home freely.
    if (isApproved && isHomePage && !alreadyHandled) {
      router.replace(MODULES_PATH);
    }
  }, [
    isLoading,
    router.isReady,
    router.pathname,
    user,
    isPending,
    isApproved,
    isApprovedOnlyPage,
    isHomePage,
    router,
  ]);

  if (isLoading) {
    return null;
  }

  // Don't render protected content while redirecting.
  if (user && isPending && isApprovedOnlyPage) {
    return null;
  }

  return <>{children}</>;
}
