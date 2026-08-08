import { useState } from "react";
import { useForm } from "react-hook-form";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { en } from "../i18n/en";

type LoginValues = {
  email: string;
  password: string;
};

const demoCredentials: LoginValues = {
  email: "demo@myfinance.local",
  password: "DemoFinance2026!",
};

export function LoginPage() {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ defaultValues: { email: "", password: "" } });

  async function submit(values: LoginValues) {
    setFormError(null);
    try {
      await login({ email: values.email.trim().toLowerCase(), password: values.password });
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : en.auth.unexpectedError);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story" aria-labelledby="login-story-title">
        <div className="brand login-brand" aria-label={en.app.name}>
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>{en.app.name}</span>
        </div>
        <div>
          <span className="eyebrow">{en.auth.eyebrow}</span>
          <h1 id="login-story-title">{en.auth.storyTitle}</h1>
          <p>{en.auth.storyDescription}</p>
        </div>
        <p className="login-privacy">{en.auth.privacy}</p>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <div className="login-heading">
            <span className="eyebrow">{en.auth.welcomeBack}</span>
            <h2 id="login-title">{en.auth.signIn}</h2>
            <p>{en.auth.signInDescription}</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit(submit)} noValidate>
            <label className="form-field">
              <span>{en.auth.email}</span>
              <input
                autoComplete="email"
                inputMode="email"
                aria-invalid={Boolean(errors.email)}
                {...register("email", {
                  required: en.auth.emailRequired,
                  maxLength: { value: 320, message: en.auth.emailInvalid },
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: en.auth.emailInvalid },
                })}
              />
              {errors.email ? <small className="field-error">{errors.email.message}</small> : null}
            </label>

            <label className="form-field">
              <span>{en.auth.password}</span>
              <input
                autoComplete="current-password"
                type="password"
                aria-invalid={Boolean(errors.password)}
                {...register("password", {
                  required: en.auth.passwordRequired,
                  minLength: { value: 8, message: en.auth.passwordInvalid },
                  maxLength: { value: 128, message: en.auth.passwordInvalid },
                })}
              />
              {errors.password ? (
                <small className="field-error">{errors.password.message}</small>
              ) : null}
            </label>

            {formError ? (
              <div className="form-alert" role="alert">
                {formError}
              </div>
            ) : null}

            <Button
              className="login-submit"
              disabled={isSubmitting}
              type="submit"
              variant="primary"
            >
              {isSubmitting ? en.auth.signingIn : en.auth.signIn}
            </Button>
          </form>

          <div className="demo-credentials">
            <div>
              <strong>{en.auth.demoTitle}</strong>
              <span>{en.auth.demoDescription}</span>
            </div>
            <dl>
              <div>
                <dt>{en.auth.email}</dt>
                <dd>{demoCredentials.email}</dd>
              </div>
              <div>
                <dt>{en.auth.password}</dt>
                <dd>{demoCredentials.password}</dd>
              </div>
            </dl>
            <Button onClick={() => reset(demoCredentials)}>{en.auth.useDemo}</Button>
          </div>
        </div>
      </section>
    </main>
  );
}
