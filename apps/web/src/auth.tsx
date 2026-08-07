import { createContext, useContext, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Credentials, User } from "@bp/schema";
import { api } from "./api";

interface AuthValue {
  user: User | null;
  isLoading: boolean;
  signIn: (c: Credentials) => Promise<void>;
  signUp: (c: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    retry: false,
    staleTime: 60_000,
  });

  const onIdentityChange = () => queryClient.invalidateQueries();

  const signInMutation = useMutation({ mutationFn: api.signIn, onSuccess: onIdentityChange });
  const signUpMutation = useMutation({ mutationFn: api.signUp, onSuccess: onIdentityChange });
  const signOutMutation = useMutation({
    mutationFn: api.signOut,
    onSuccess: () => {
      // Drop every cached response — the next user must not see the last one's data.
      queryClient.clear();
      queryClient.setQueryData(["me"], { user: null });
    },
  });

  const value: AuthValue = {
    user: data?.user ?? null,
    isLoading,
    signIn: async (c) => void (await signInMutation.mutateAsync(c)),
    signUp: async (c) => void (await signUpMutation.mutateAsync(c)),
    signOut: async () => void (await signOutMutation.mutateAsync()),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>.");
  return context;
}
