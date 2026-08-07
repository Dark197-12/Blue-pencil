import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { AuthScreen } from "./routes/SignIn";
import { Projects } from "./routes/Projects";
import type { ReactNode } from "react";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) return <Navigate to="/signin" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/signin" element={<AuthScreen mode="signin" />} />
        <Route path="/signup" element={<AuthScreen mode="signup" />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Projects />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
