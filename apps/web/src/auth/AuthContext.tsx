import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getCurrentUser,
  login as requestLogin,
  logout as requestLogout,
  register as requestRegister,
  verifyLoginRecoveryCode,
  verifyLoginTOTP,
  type LoginRequest,
  type RegisterRequest,
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
    const result = await requestLogin(payload);
    if ("status" in result) {
      return result;
    }
    setUser(result);
    return null;
  }, []);

  const register = useCallback(async (payload: RegisterRequest) => {
    setUser(await requestRegister(payload));
  }, []);

  const verifyTOTP = useCallback(async (challengeToken: string, code: string) => {
    setUser(await verifyLoginTOTP(challengeToken, code));
  }, []);

  const verifyRecoveryCode = useCallback(async (challengeToken: string, recoveryCode: string) => {
    setUser(await verifyLoginRecoveryCode(challengeToken, recoveryCode));
  }, []);

  const logout = useCallback(async () => {
    await requestLogout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      login,
      register,
      verifyTOTP,
      verifyRecoveryCode,
      logout,
      updateUser: setUser,
    }),
    [isLoading, login, logout, register, user, verifyRecoveryCode, verifyTOTP],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
