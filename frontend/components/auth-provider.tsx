"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearToken, getStoredToken, storeToken } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (credential: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const handleUnauthorized = () => {
      clearToken();
      setUser(null);
      setLoading(false);
      router.replace("/login");
    };
    window.addEventListener("apaar:unauthorized", handleUnauthorized);

    if (!getStoredToken()) {
      const timeout = window.setTimeout(() => setLoading(false), 0);
      return () => {
        window.clearTimeout(timeout);
        window.removeEventListener("apaar:unauthorized", handleUnauthorized);
      };
    }
    let active = true;
    api.me().then((authenticatedUser) => {
      if (active) setUser(authenticatedUser);
    }).catch(() => {
      if (active) setUser(null);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      window.removeEventListener("apaar:unauthorized", handleUnauthorized);
    };
  }, [router]);

  const establishSession = useCallback(async (accessToken: string) => {
    storeToken(accessToken);
    try {
      const authenticatedUser = await api.me();
      setUser(authenticatedUser);
      router.replace(authenticatedUser.role === "verifier" ? "/verification" : "/dashboard");
    } catch (error) {
      clearToken();
      throw error;
    }
  }, [router]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    await establishSession(result.access_token);
  }, [establishSession]);

  const signInWithGoogle = useCallback(async (credential: string) => {
    const result = await api.googleLogin(credential);
    await establishSession(result.access_token);
  }, [establishSession]);

  const signOut = useCallback(() => {
    clearToken();
    setUser(null);
    router.replace("/login");
  }, [router]);

  const value = useMemo(
    () => ({ user, loading, signIn, signInWithGoogle, signOut }),
    [user, loading, signIn, signInWithGoogle, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
