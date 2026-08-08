import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import {
  ApiError,
  changePassword,
  confirmTOTP,
  deleteAccount,
  disableTOTP,
  listSessions,
  revokeSession,
  setupTOTP,
  updateProfile,
  updateSettings,
  type Session,
  type TOTPSetupResponse,
  type UpdateUserSettingsRequest,
} from "../api/client";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { supportedCurrencies } from "../financial-options";
import { en } from "../i18n/en";

type ProfileValues = { displayName: string; email: string; currentPassword: string };
type PasswordValues = { currentPassword: string; newPassword: string };
type TOTPCodeValues = { code: string };
type TOTPDisableValues = { password: string; code: string };
type DeleteValues = { password: string };
type PreferencesValues = UpdateUserSettingsRequest;

export function SettingsPage() {
  const { user, updateUser } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [totpSetup, setTotpSetup] = useState<TOTPSetupResponse | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const profileForm = useForm<ProfileValues>({
    values: {
      displayName: user?.displayName ?? "",
      email: user?.email ?? "",
      currentPassword: "",
    },
  });
  const passwordForm = useForm<PasswordValues>();
  const preferencesForm = useForm<PreferencesValues>({
    values: {
      timezone: user?.timezone ?? "UTC",
      functionalCurrency: user?.functionalCurrency ?? "USD",
      displayCurrency: user?.displayCurrency ?? "USD",
      reconciliationMode: user?.reconciliationMode ?? "CONFIRM",
    },
  });
  const totpCodeForm = useForm<TOTPCodeValues>();
  const totpDisableForm = useForm<TOTPDisableValues>();
  const deleteForm = useForm<DeleteValues>();

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listSessions());
      setSessionsError(null);
    } catch (error) {
      setSessionsError(error instanceof ApiError ? error.message : en.settings.actionFailed);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void listSessions()
      .then((items) => {
        if (!active) return;
        setSessions(items);
        setSessionsError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSessionsError(error instanceof ApiError ? error.message : en.settings.actionFailed);
      });
    return () => {
      active = false;
    };
  }, []);

  function beginAction() {
    setNotice(null);
    setActionError(null);
  }

  function failAction(error: unknown) {
    setActionError(error instanceof ApiError ? error.message : en.settings.actionFailed);
  }

  async function saveProfile(values: ProfileValues) {
    beginAction();
    try {
      const updated = await updateProfile({
        displayName: values.displayName.trim(),
        email: values.email.trim().toLowerCase(),
        ...(values.currentPassword ? { currentPassword: values.currentPassword } : {}),
      });
      updateUser(updated);
      setNotice(en.settings.profileSaved);
      profileForm.setValue("currentPassword", "");
    } catch (error) {
      failAction(error);
    }
  }

  async function savePassword(values: PasswordValues) {
    beginAction();
    try {
      await changePassword(values);
      passwordForm.reset();
      setNotice(en.settings.passwordChanged);
      await refreshSessions();
    } catch (error) {
      failAction(error);
    }
  }

  async function savePreferences(values: PreferencesValues) {
    beginAction();
    try {
      updateUser(await updateSettings(values));
      setNotice(en.settings.preferencesSaved);
    } catch (error) {
      failAction(error);
    }
  }

  async function startTOTP() {
    beginAction();
    try {
      setTotpSetup(await setupTOTP());
    } catch (error) {
      failAction(error);
    }
  }

  async function finishTOTP(values: TOTPCodeValues) {
    beginAction();
    try {
      const codes = await confirmTOTP(values.code);
      setRecoveryCodes(codes);
      setTotpSetup(null);
      updateUser(user ? { ...user, totpEnabled: true } : null);
      totpCodeForm.reset();
      setNotice(en.settings.twoFactorEnabled);
    } catch (error) {
      failAction(error);
    }
  }

  async function turnOffTOTP(values: TOTPDisableValues) {
    beginAction();
    try {
      await disableTOTP(values.password, values.code);
      updateUser(user ? { ...user, totpEnabled: false } : null);
      totpDisableForm.reset();
      setRecoveryCodes([]);
      setNotice(en.settings.twoFactorDisabled);
    } catch (error) {
      failAction(error);
    }
  }

  async function revoke(item: Session) {
    beginAction();
    try {
      await revokeSession(item.id);
      if (item.current) {
        updateUser(null);
      } else {
        await refreshSessions();
        setNotice(en.settings.sessionRevoked);
      }
    } catch (error) {
      failAction(error);
    }
  }

  async function removeAccount(values: DeleteValues) {
    beginAction();
    try {
      await deleteAccount(values.password);
      updateUser(null);
    } catch (error) {
      failAction(error);
    }
  }

  return (
    <section className="page-stack">
      <header className="section-intro">
        <span className="eyebrow">{en.settings.eyebrow}</span>
        <h2>{en.settings.title}</h2>
        <p>{en.settings.description}</p>
      </header>

      {notice ? (
        <div className="form-success" role="status">
          {notice}
        </div>
      ) : null}
      {actionError ? (
        <div className="form-alert" role="alert">
          {actionError}
        </div>
      ) : null}

      <div className="settings-grid">
        <Card title={en.settings.profile} subtitle={en.settings.profileDescription}>
          <form className="settings-form" onSubmit={profileForm.handleSubmit(saveProfile)}>
            <label className="form-field">
              <span>{en.auth.displayName}</span>
              <input
                autoComplete="name"
                {...profileForm.register("displayName", { required: true, maxLength: 100 })}
              />
            </label>
            <label className="form-field">
              <span>{en.auth.email}</span>
              <input
                autoComplete="email"
                type="email"
                {...profileForm.register("email", { required: true })}
              />
            </label>
            <label className="form-field">
              <span>{en.settings.currentPasswordForEmail}</span>
              <input
                autoComplete="current-password"
                type="password"
                {...profileForm.register("currentPassword")}
              />
            </label>
            <Button disabled={profileForm.formState.isSubmitting} type="submit" variant="primary">
              {en.settings.saveProfile}
            </Button>
          </form>
        </Card>

        <Card title={en.settings.preferences} subtitle={en.settings.preferencesDescription}>
          <form className="settings-form" onSubmit={preferencesForm.handleSubmit(savePreferences)}>
            <label className="form-field">
              <span>{en.settings.timezone}</span>
              <input {...preferencesForm.register("timezone", { required: true })} />
            </label>
            <label className="form-field">
              <span>{en.settings.functionalCurrency}</span>
              <select {...preferencesForm.register("functionalCurrency")}>
                {supportedCurrencies.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
              <small className="field-hint">{en.settings.functionalCurrencyHint}</small>
            </label>
            <label className="form-field">
              <span>{en.settings.displayCurrency}</span>
              <select {...preferencesForm.register("displayCurrency")}>
                {supportedCurrencies.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>{en.settings.reconciliation}</span>
              <select {...preferencesForm.register("reconciliationMode")}>
                <option value="CONFIRM">{en.onboarding.confirmMode}</option>
                <option value="AUTO">{en.onboarding.autoMode}</option>
              </select>
            </label>
            <Button
              disabled={preferencesForm.formState.isSubmitting}
              type="submit"
              variant="primary"
            >
              {en.settings.savePreferences}
            </Button>
          </form>
        </Card>

        <Card title={en.settings.password} subtitle={en.settings.passwordDescription}>
          <form className="settings-form" onSubmit={passwordForm.handleSubmit(savePassword)}>
            <label className="form-field">
              <span>{en.settings.currentPassword}</span>
              <input
                autoComplete="current-password"
                type="password"
                {...passwordForm.register("currentPassword", { required: true })}
              />
            </label>
            <label className="form-field">
              <span>{en.settings.newPassword}</span>
              <input
                autoComplete="new-password"
                type="password"
                {...passwordForm.register("newPassword", {
                  required: true,
                  minLength: 12,
                  maxLength: 128,
                })}
              />
            </label>
            <Button disabled={passwordForm.formState.isSubmitting} type="submit">
              {en.settings.changePassword}
            </Button>
          </form>
        </Card>

        <Card title={en.settings.twoFactor} subtitle={en.settings.twoFactorDescription}>
          {!user?.totpEnabled && !totpSetup ? (
            <Button onClick={() => void startTOTP()} variant="primary">
              {en.settings.setupTwoFactor}
            </Button>
          ) : null}
          {totpSetup ? (
            <div className="security-setup">
              <p>{en.settings.authenticatorInstructions}</p>
              <code>{totpSetup.secret}</code>
              <details>
                <summary>{en.settings.provisioningUri}</summary>
                <code>{totpSetup.provisioningUri}</code>
              </details>
              <form className="settings-form" onSubmit={totpCodeForm.handleSubmit(finishTOTP)}>
                <label className="form-field">
                  <span>{en.auth.authenticatorCode}</span>
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    {...totpCodeForm.register("code", { required: true, pattern: /^[0-9]{6}$/ })}
                  />
                </label>
                <Button type="submit" variant="primary">
                  {en.settings.confirmTwoFactor}
                </Button>
              </form>
            </div>
          ) : null}
          {recoveryCodes.length > 0 ? (
            <div className="recovery-codes" role="status">
              <strong>{en.settings.saveRecoveryCodes}</strong>
              <p>{en.settings.recoveryCodesOnce}</p>
              <ul>
                {recoveryCodes.map((code) => (
                  <li key={code}>
                    <code>{code}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {user?.totpEnabled ? (
            <form className="settings-form" onSubmit={totpDisableForm.handleSubmit(turnOffTOTP)}>
              <label className="form-field">
                <span>{en.settings.currentPassword}</span>
                <input
                  type="password"
                  {...totpDisableForm.register("password", { required: true })}
                />
              </label>
              <label className="form-field">
                <span>{en.auth.authenticatorCode}</span>
                <input
                  inputMode="numeric"
                  {...totpDisableForm.register("code", { required: true })}
                />
              </label>
              <Button type="submit">{en.settings.disableTwoFactor}</Button>
            </form>
          ) : null}
        </Card>

        <Card title={en.settings.sessions} subtitle={en.settings.sessionsDescription}>
          {sessionsError ? <div className="form-alert">{sessionsError}</div> : null}
          <div className="session-list">
            {sessions.map((session) => (
              <div key={session.id} className="session-row">
                <div>
                  <strong>
                    {session.current ? en.settings.currentSession : en.settings.otherSession}
                  </strong>
                  <span>{session.userAgent || en.settings.unknownDevice}</span>
                  <small>
                    {en.settings.lastSeen} {new Date(session.lastSeenAt).toLocaleString()}
                  </small>
                </div>
                <Button onClick={() => void revoke(session)}>
                  {session.current ? en.auth.signOut : en.settings.revoke}
                </Button>
              </div>
            ))}
          </div>
        </Card>

        <Card
          className="danger-card"
          title={en.settings.deleteAccount}
          subtitle={en.settings.deleteAccountDescription}
        >
          <form className="settings-form" onSubmit={deleteForm.handleSubmit(removeAccount)}>
            <label className="form-field">
              <span>{en.settings.confirmWithPassword}</span>
              <input type="password" {...deleteForm.register("password", { required: true })} />
            </label>
            <Button type="submit">{en.settings.deletePermanently}</Button>
          </form>
        </Card>
      </div>
    </section>
  );
}
