import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { en } from "../i18n/en";

type RegisterValues = {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export function RegisterPage() {
  const { register: registerIdentity } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    getValues,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>();

  async function submit(values: RegisterValues) {
    setFormError(null);
    try {
      await registerIdentity({
        displayName: values.displayName.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
      });
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : en.auth.unexpectedError);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story" aria-labelledby="register-story-title">
        <div className="brand login-brand" aria-label={en.app.name}>
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>{en.app.name}</span>
        </div>
        <div>
          <span className="eyebrow">{en.auth.eyebrow}</span>
          <h1 id="register-story-title">{en.auth.registerStoryTitle}</h1>
          <p>{en.auth.registerStoryDescription}</p>
        </div>
        <p className="login-privacy">{en.auth.privacy}</p>
      </section>

      <section className="login-panel" aria-labelledby="register-title">
        <div className="login-card">
          <div className="login-heading">
            <span className="eyebrow">{en.auth.newWorkspace}</span>
            <h2 id="register-title">{en.auth.createAccount}</h2>
            <p>{en.auth.registerDescription}</p>
          </div>
          <form className="login-form" onSubmit={handleSubmit(submit)} noValidate>
            <label className="form-field">
              <span>{en.auth.displayName}</span>
              <input
                autoComplete="name"
                {...register("displayName", {
                  required: en.auth.displayNameRequired,
                  maxLength: { value: 100, message: en.auth.displayNameInvalid },
                })}
              />
              {errors.displayName ? (
                <small className="field-error">{errors.displayName.message}</small>
              ) : null}
            </label>
            <label className="form-field">
              <span>{en.auth.email}</span>
              <input
                autoComplete="email"
                inputMode="email"
                {...register("email", {
                  required: en.auth.emailRequired,
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: en.auth.emailInvalid },
                })}
              />
              {errors.email ? <small className="field-error">{errors.email.message}</small> : null}
            </label>
            <label className="form-field">
              <span>{en.auth.password}</span>
              <input
                autoComplete="new-password"
                type="password"
                {...register("password", {
                  required: en.auth.passwordRequired,
                  minLength: { value: 12, message: en.auth.newPasswordInvalid },
                  maxLength: { value: 128, message: en.auth.newPasswordInvalid },
                })}
              />
              {errors.password ? (
                <small className="field-error">{errors.password.message}</small>
              ) : null}
            </label>
            <label className="form-field">
              <span>{en.auth.confirmPassword}</span>
              <input
                autoComplete="new-password"
                type="password"
                {...register("confirmPassword", {
                  validate: (value) =>
                    value === getValues("password") || en.auth.passwordsDoNotMatch,
                })}
              />
              {errors.confirmPassword ? (
                <small className="field-error">{errors.confirmPassword.message}</small>
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
              {isSubmitting ? en.auth.creatingAccount : en.auth.createAccount}
            </Button>
          </form>
          <p className="auth-switch">
            {en.auth.haveAccount} <Link to="/login">{en.auth.signIn}</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
