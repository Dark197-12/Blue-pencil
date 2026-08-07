import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { credentialsSchema } from "@bp/schema";
import { useAuth } from "../auth";
import { RequestError } from "../api";

/** Sign-in and sign-up share a form; only the copy and the endpoint differ. */
export function AuthScreen({ mode }: { mode: "signin" | "signup" }) {
  const { user, isLoading, signIn, signUp } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading) return null;
  if (user) return <Navigate to="/" replace state={{ from: location }} />;

  const isSignUp = mode === "signup";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "_");
        if (!next[key]) next[key] = issue.message;
      }
      setFieldErrors(next);
      return;
    }

    setBusy(true);
    try {
      await (isSignUp ? signUp(parsed.data) : signIn(parsed.data));
    } catch (error) {
      if (error instanceof RequestError) {
        if (error.fields) setFieldErrors(error.fields);
        else setFormError(error.message);
      } else {
        setFormError("Something went wrong. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100%",
        display: "grid",
        placeItems: "center",
        padding: "40px 20px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380, display: "grid", gap: 22 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <span className="brand-mark">Blue Pencil</span>
          <h1 style={{ fontFamily: "var(--serif)", fontSize: 24 }}>
            {isSignUp ? "Start a new manuscript" : "Welcome back"}
          </h1>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, lineHeight: 1.55 }}>
            {isSignUp
              ? "Measure how each character speaks, and catch the moments they stop sounding like themselves."
              : "Sign in to pick up where you left off."}
          </p>
        </div>

        <form className="card" onSubmit={onSubmit} style={{ padding: 20, display: "grid", gap: 16 }} noValidate>
          {formError && <p className="banner">{formError}</p>}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
              required
            />
            {fieldErrors.email && <span className="error">{fieldErrors.email}</span>}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
              required
            />
            {fieldErrors.password ? (
              <span className="error">{fieldErrors.password}</span>
            ) : (
              isSignUp && <span className="hint">At least 12 characters. Length beats punctuation.</span>
            )}
          </div>

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "One moment…" : isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>

        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
          {isSignUp ? (
            <>
              Already have an account? <Link to="/signin">Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link to="/signup">Create an account</Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
