import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getCurrentUser,
  login as requestLogin,
  logout as requestLogout,
  type LoginRequest,
  type User,
} from "../api/client";
import { AuthContext } from "./auth-context";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    void getCurrentUser(controller.signal)
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, []);

  const login = useCallback(async (payload: LoginRequest) => {
    setUser(await requestLogin(payload));
  }, []);

  const logout = useCallback(async () => {
    await requestLogout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, login, logout }),
    [isLoading, login, logout, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
