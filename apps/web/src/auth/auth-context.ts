import { createContext } from "react";

import type { LoginChallengeResponse, LoginRequest, RegisterRequest, User } from "../api/client";

export type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  login: (payload: LoginRequest) => Promise<LoginChallengeResponse | null>;
  register: (payload: RegisterRequest) => Promise<void>;
  verifyTOTP: (challengeToken: string, code: string) => Promise<void>;
  verifyRecoveryCode: (challengeToken: string, recoveryCode: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: User | null) => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
