import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { en } from "../i18n/en";

type LoginValues = {
  email: string;
  password: string;
};

type SecondFactorValues = { code: string };

const demoCredentials: LoginValues = {
  email: "demo@myfinance.local",
  password: "DemoFinance2026!",
};

export function LoginPage() {
  const { login, verifyRecoveryCode, verifyTOTP } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ defaultValues: { email: "", password: "" } });
  const secondFactorForm = useForm<SecondFactorValues>({ defaultValues: { code: "" } });

  async function submit(values: LoginValues) {
    setFormError(null);
    try {
      const challenge = await login({
        email: values.email.trim().toLowerCase(),
        password: values.password,
      });
      if (challenge) {
        setChallengeToken(challenge.challengeToken);
      }
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : en.auth.unexpectedError);
    }
  }

  async function submitSecondFactor(values: SecondFactorValues) {
    if (!challengeToken) return;
    setFormError(null);
    try {
      if (useRecovery) {
        await verifyRecoveryCode(challengeToken, values.code);
      } else {
        await verifyTOTP(challengeToken, values.code);
      }
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
            <h2 id="login-title">{challengeToken ? en.auth.twoFactorTitle : en.auth.signIn}</h2>
            <p>{challengeToken ? en.auth.twoFactorDescription : en.auth.signInDescription}</p>
          </div>

          {challengeToken ? (
            <form
              className="login-form"
              onSubmit={secondFactorForm.handleSubmit(submitSecondFactor)}
              noValidate
            >
              <label className="form-field">
                <span>{useRecovery ? en.auth.recoveryCode : en.auth.authenticatorCode}</span>
                <input
                  autoComplete="one-time-code"
                  inputMode={useRecovery ? "text" : "numeric"}
                  {...secondFactorForm.register("code", {
                    required: en.auth.codeRequired,
                    minLength: { value: useRecovery ? 16 : 6, message: en.auth.codeInvalid },
                  })}
                />
                {secondFactorForm.formState.errors.code ? (
                  <small className="field-error">
                    {secondFactorForm.formState.errors.code.message}
                  </small>
                ) : null}
              </label>
              {formError ? (
                <div className="form-alert" role="alert">
                  {formError}
                </div>
              ) : null}
              <Button
                className="login-submit"
                disabled={secondFactorForm.formState.isSubmitting}
                type="submit"
                variant="primary"
              >
                {en.auth.verifyAndSignIn}
              </Button>
              <Button
                onClick={() => {
                  setUseRecovery((current) => !current);
                  secondFactorForm.reset();
                  setFormError(null);
                }}
              >
                {useRecovery ? en.auth.useAuthenticator : en.auth.useRecoveryCode}
              </Button>
            </form>
          ) : (
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
                {errors.email ? (
                  <small className="field-error">{errors.email.message}</small>
                ) : null}
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
          )}

          {!challengeToken ? (
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
          ) : null}
          {!challengeToken ? (
            <p className="auth-switch">
              {en.auth.noAccount} <Link to="/register">{en.auth.createAccount}</Link>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
