import { createRoot, createSignal } from "solid-js";

import {
  fetchSession,
  signInWithPassword,
  signOutSession,
  type AuthSession,
} from "~/libs/api-client";

export const authStore = createRoot(() => {
  const [session, setSession] = createSignal<AuthSession | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);

  const init = async () => {
    setIsLoading(true);
    try {
      const data = await fetchSession();
      setSession(data);
    } catch {
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string): Promise<void> => {
    setIsLoading(true);
    try {
      await signInWithPassword(email, password);
      await init();
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    await signOutSession();
    setSession(null);
  };

  return {
    get session() {
      return session();
    },
    get user() {
      return session()?.user ?? null;
    },
    get isAuthenticated() {
      return session() !== null;
    },
    get isLoading() {
      return isLoading();
    },
    init,
    login,
    logout,
  };
});
