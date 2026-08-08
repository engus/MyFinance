import { Navigate, Outlet, useLocation } from "react-router-dom";

import { en } from "../i18n/en";
import { useAuth } from "./useAuth";

export function RequireAuth() {
  const { isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <AuthLoading />;
  }
  if (!user) {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  }
  return <Outlet />;
}

export function PublicOnly() {
  const { isLoading, user } = useAuth();

  if (isLoading) {
    return <AuthLoading />;
  }
  if (user) {
    return <Navigate replace to={user.onboardingCompleted ? "/dashboard" : "/onboarding"} />;
  }
  return <Outlet />;
}

export function RequireCompletedOnboarding() {
  const { user } = useAuth();
  if (user && !user.onboardingCompleted) {
    return <Navigate replace to="/onboarding" />;
  }
  return <Outlet />;
}

export function RequirePendingOnboarding() {
  const { user } = useAuth();
  if (user?.onboardingCompleted) {
    return <Navigate replace to="/dashboard" />;
  }
  return <Outlet />;
}

function AuthLoading() {
  return (
    <main className="auth-loading" role="status">
      <span className="brand-mark" aria-hidden="true">
        M
      </span>
      <span>{en.auth.checkingSession}</span>
    </main>
  );
}
