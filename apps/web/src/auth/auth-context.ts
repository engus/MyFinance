import { createContext } from "react";

import type { LoginRequest, User } from "../api/client";

export type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  login: (payload: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
