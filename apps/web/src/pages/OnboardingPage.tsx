import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";

import { ApiError, completeOnboarding, type CompleteOnboardingRequest } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { supportedCurrencies } from "../financial-options";
import { en } from "../i18n/en";

type OnboardingValues = {
  timezone: string;
  functionalCurrency: CompleteOnboardingRequest["functionalCurrency"];
  displayCurrency: CompleteOnboardingRequest["displayCurrency"];
  reconciliationMode: CompleteOnboardingRequest["reconciliationMode"];
  accountName: string;
  accountClass: CompleteOnboardingRequest["account"]["accountClass"];
  accountSubtype: CompleteOnboardingRequest["account"]["subtype"];
  accountCurrency: CompleteOnboardingRequest["account"]["currency"];
  openingBalance: string;
  openingBalanceDate: string;
  recurringEnabled: boolean;
  recurringName: string;
  recurringAmount: string;
  recurringCurrency: CompleteOnboardingRequest["functionalCurrency"];
  recurringDay: number;
};

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function OnboardingPage() {
  const { user, updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingValues>({
    defaultValues: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      functionalCurrency: "USD",
      displayCurrency: "USD",
      reconciliationMode: "CONFIRM",
      accountName: en.onboarding.defaultAccountName,
      accountClass: "ASSET",
      accountSubtype: "bank",
      accountCurrency: "USD",
      openingBalance: "0",
      openingBalanceDate: localDate(),
      recurringEnabled: false,
      recurringName: en.onboarding.defaultIncomeName,
      recurringAmount: "",
      recurringCurrency: "USD",
      recurringDay: 1,
    },
  });
  const recurringEnabled = watch("recurringEnabled");
  const accountClass = watch("accountClass");

  useEffect(() => {
    setValue("accountSubtype", accountClass === "LIABILITY" ? "mortgage" : "bank");
  }, [accountClass, setValue]);

  async function submit(values: OnboardingValues) {
    setFormError(null);
    const payload: CompleteOnboardingRequest = {
      timezone: values.timezone,
      functionalCurrency: values.functionalCurrency,
      displayCurrency: values.displayCurrency,
      reconciliationMode: values.reconciliationMode,
      account: {
        name: values.accountName.trim(),
        accountClass: values.accountClass,
        subtype: values.accountSubtype,
        currency: values.accountCurrency,
        openingBalance: values.openingBalance,
        openingBalanceDate: values.openingBalanceDate,
      },
      ...(values.recurringEnabled
        ? {
            recurringIncome: {
              name: values.recurringName.trim(),
              amount: values.recurringAmount,
              currency: values.recurringCurrency,
              dayOfMonth: Number(values.recurringDay),
            },
          }
        : {}),
    };
    try {
      const updated = await completeOnboarding(payload);
      updateUser(updated);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : en.onboarding.unexpectedError);
    }
  }

  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <div className="brand" aria-label={en.app.name}>
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>{en.app.name}</span>
        </div>
        <div className="onboarding-user">
          <span>{user?.email}</span>
          <Button onClick={() => void logout()}>{en.auth.signOut}</Button>
        </div>
      </header>

      <form className="onboarding-content" onSubmit={handleSubmit(submit)} noValidate>
        <div className="onboarding-intro">
          <span className="eyebrow">{en.onboarding.eyebrow}</span>
          <h1>{en.onboarding.title}</h1>
          <p>{en.onboarding.description}</p>
        </div>

        <section className="setup-section" aria-labelledby="preferences-title">
          <div className="setup-section-heading">
            <span>01</span>
            <div>
              <h2 id="preferences-title">{en.onboarding.preferences}</h2>
              <p>{en.onboarding.preferencesDescription}</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span>{en.settings.timezone}</span>
              <input {...register("timezone", { required: en.onboarding.timezoneRequired })} />
              {errors.timezone ? (
                <small className="field-error">{errors.timezone.message}</small>
              ) : null}
            </label>
            <label className="form-field">
              <span>{en.settings.functionalCurrency}</span>
              <select {...register("functionalCurrency")}>
                {supportedCurrencies.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
              <small className="field-hint">{en.onboarding.functionalCurrencyHint}</small>
            </label>
            <label className="form-field">
              <span>{en.onboarding.displayCurrency}</span>
              <select {...register("displayCurrency")}>
                {supportedCurrencies.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>{en.onboarding.reconciliationMode}</span>
              <select {...register("reconciliationMode")}>
                <option value="CONFIRM">{en.onboarding.confirmMode}</option>
                <option value="AUTO">{en.onboarding.autoMode}</option>
              </select>
            </label>
          </div>
        </section>

        <section className="setup-section" aria-labelledby="account-title">
          <div className="setup-section-heading">
            <span>02</span>
            <div>
              <h2 id="account-title">{en.onboarding.firstAccount}</h2>
              <p>{en.onboarding.firstAccountDescription}</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span>{en.onboarding.accountName}</span>
              <input
                {...register("accountName", { required: en.onboarding.accountNameRequired })}
              />
            </label>
            <label className="form-field">
              <span>{en.onboarding.accountClass}</span>
              <select {...register("accountClass")}>
                <option value="ASSET">{en.onboarding.asset}</option>
                <option value="LIABILITY">{en.onboarding.liability}</option>
              </select>
            </label>
            <label className="form-field">
              <span>{en.onboarding.accountType}</span>
              <select {...register("accountSubtype")}>
                {accountClass === "ASSET" ? (
                  <>
                    <option value="bank">{en.onboarding.bank}</option>
                    <option value="cash">{en.onboarding.cash}</option>
                    <option value="brokerage">{en.onboarding.brokerage}</option>
                    <option value="real_estate">{en.onboarding.realEstate}</option>
                    <option value="vehicle">{en.onboarding.vehicle}</option>
                    <option value="security">{en.onboarding.securities}</option>
                    <option value="other">{en.onboarding.other}</option>
                  </>
                ) : (
                  <>
                    <option value="mortgage">{en.onboarding.mortgage}</option>
                    <option value="loan">{en.onboarding.loan}</option>
                    <option value="other">{en.onboarding.other}</option>
                  </>
                )}
              </select>
            </label>
            <label className="form-field">
              <span>{en.onboarding.accountCurrency}</span>
              <select {...register("accountCurrency")}>
                {supportedCurrencies.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>{en.onboarding.openingBalance}</span>
              <input
                inputMode="decimal"
                {...register("openingBalance", {
                  required: en.onboarding.openingBalanceRequired,
                  pattern: {
                    value: /^-?(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/,
                    message: en.onboarding.amountInvalid,
                  },
                })}
              />
              {errors.openingBalance ? (
                <small className="field-error">{errors.openingBalance.message}</small>
              ) : null}
            </label>
            <label className="form-field">
              <span>{en.onboarding.balanceDate}</span>
              <input
                type="date"
                {...register("openingBalanceDate", { required: en.onboarding.balanceDateRequired })}
              />
            </label>
          </div>
        </section>

        <section className="setup-section" aria-labelledby="income-title">
          <div className="setup-section-heading">
            <span>03</span>
            <div>
              <h2 id="income-title">{en.onboarding.recurringIncome}</h2>
              <p>{en.onboarding.recurringIncomeDescription}</p>
            </div>
          </div>
          <label className="check-field">
            <input type="checkbox" {...register("recurringEnabled")} />
            <span>{en.onboarding.addRecurringIncome}</span>
          </label>
          {recurringEnabled ? (
            <div className="form-grid setup-subform">
              <label className="form-field">
                <span>{en.onboarding.incomeName}</span>
                <input
                  {...register("recurringName", { required: en.onboarding.incomeNameRequired })}
                />
              </label>
              <label className="form-field">
                <span>{en.onboarding.amount}</span>
                <input
                  inputMode="decimal"
                  {...register("recurringAmount", {
                    required: en.onboarding.amountRequired,
                    pattern: {
                      value: /^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/,
                      message: en.onboarding.amountInvalid,
                    },
                  })}
                />
              </label>
              <label className="form-field">
                <span>{en.onboarding.currency}</span>
                <select {...register("recurringCurrency")}>
                  {supportedCurrencies.map((currency) => (
                    <option key={currency}>{currency}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>{en.onboarding.dayOfMonth}</span>
                <input
                  type="number"
                  min="1"
                  max="28"
                  {...register("recurringDay", { valueAsNumber: true, min: 1, max: 28 })}
                />
              </label>
            </div>
          ) : null}
        </section>

        {formError ? (
          <div className="form-alert" role="alert">
            {formError}
          </div>
        ) : null}
        <div className="onboarding-actions">
          <p>{en.onboarding.pendingLedgerNote}</p>
          <Button disabled={isSubmitting} type="submit" variant="primary">
            {isSubmitting ? en.onboarding.saving : en.onboarding.complete}
          </Button>
        </div>
      </form>
    </main>
  );
}
