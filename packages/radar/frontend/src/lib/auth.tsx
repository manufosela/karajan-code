"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import type { User, LoginResponse, ActiveUser } from "@/types/auth";

const TOKEN_KEY = "ofr-token";

/** Polling interval for active users (30 seconds). */
const ACTIVE_USERS_POLL_MS = 30_000;

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSuperadmin: boolean;
  isAdmin: boolean;
  isUser: boolean;
  activeUsers: ActiveUser[];
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const router = useRouter();
  const pathname = usePathname();

  const clearAuth = useCallback(() => {
    setUser(null);
    setToken(null);
    setActiveUsers([]);
    localStorage.removeItem(TOKEN_KEY);
  }, []);

  const fetchActiveUsers = useCallback(async (currentToken: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/active-users`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (res.ok) {
        const data: ActiveUser[] = await res.json();
        setActiveUsers(data);
      }
    } catch {
      // Silently ignore polling errors
    }
  }, []);

  // On mount, validate stored token
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) {
      setIsLoading(false);
      return;
    }

    fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Invalid token");
        return res.json();
      })
      .then((userData: User) => {
        setToken(storedToken);
        setUser(userData);
      })
      .catch(() => {
        clearAuth();
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll active users every 30 seconds when authenticated
  useEffect(() => {
    if (!token) return;

    // Fetch immediately on auth
    fetchActiveUsers(token);

    const interval = setInterval(() => {
      fetchActiveUsers(token);
    }, ACTIVE_USERS_POLL_MS);

    return () => clearInterval(interval);
  }, [token, fetchActiveUsers]);

  // Redirect unauthenticated users away from protected routes
  useEffect(() => {
    if (isLoading) return;
    if (!user && pathname !== "/login") {
      router.replace("/login");
    }
    if (user && pathname === "/login") {
      router.replace("/");
    }
  }, [isLoading, user, pathname, router]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message =
          typeof body.detail === "string"
            ? body.detail
            : "Invalid email or password";
        throw new Error(message);
      }

      const data: LoginResponse = await res.json();
      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setUser(data.user);
      router.replace("/");
    },
    [router]
  );

  const logout = useCallback(() => {
    clearAuth();
    router.replace("/login");
  }, [clearAuth, router]);

  const isSuperadmin = user?.role === "superadmin";
  const isAdmin = user?.role === "superadmin" || user?.role === "admin";
  const isUser = user?.role === "user";

  const value = useMemo(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: !!user,
      isSuperadmin,
      isAdmin,
      isUser,
      activeUsers,
      login,
      logout,
    }),
    [user, token, isLoading, isSuperadmin, isAdmin, isUser, activeUsers, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
