import Head from "next/head";
import { useState, type FormEvent } from "react";
import AppShell from "@/components/main/AppShell";
import Modal from "@/components/main/Modal";
import NotificationSetupModal from "@/components/notifications/NotificationSetupModal";
import UpcomingSession from "@/components/modules/UpcomingSession";
import NotificationsPanel from "@/components/notifications/NotificationsPanel";
import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import { LockIcon } from "@/components/ui/icons";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAsync } from "@/hooks/useAsync";
import { useFormSubmit } from "@/hooks/useFormSubmit";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { updateProfile, changePassword, getNotificationPreferences, updateNotificationPreferences } from "@/lib/api";
import { pageTitle } from "@/lib/pageTitle";
import Button from "@/components/ui/Button";

type ReminderKey = "daily_content_reminder" | "survey_unlocked_reminder" | "daily_survey_reminder";
type Reminders = Record<ReminderKey, boolean>;

type SaveStatus = "idle" | "saving" | "success" | "error";

// Shown until the user's saved preferences load (the backend's defaults).
const DEFAULT_REMINDERS: Reminders = {
  daily_content_reminder: true,
  survey_unlocked_reminder: false,
  daily_survey_reminder: false,
};

const REMINDER_TOGGLES: { key: ReminderKey; id: string; label: string; description: string }[] = [
  {
    key: "daily_content_reminder",
    id: "dailyContentReminder",
    label: "Daily content reminder",
    description: "Notify me daily around 5pm to complete any unviewed module content",
  },
  {
    key: "survey_unlocked_reminder",
    id: "surveyUnlockedReminder",
    label: "New survey unlocked reminder",
    description: "Notify me when a module's survey is unlocked",
  },
  {
    key: "daily_survey_reminder",
    id: "dailySurveyCompletionReminder",
    label: "Daily survey completion reminder",
    description: "Notify me daily around 5pm to submit any uncompleted surveys.",
  },
];

// Set max length of displayname!
const DISPLAY_NAME_MAX_LENGTH = 20;

const FIELD_CLASS =
  "rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue";
const OUTLINE_BUTTON_CLASS =
  "rounded-lg border border-brand-blue px-4 py-2 text-sm font-medium text-brand-blue transition-colors hover:bg-brand-blue/5";
const ADMIN_EMAIL = "sarah.j.moore@rcswa.edu.au";

function sanitizeDisplayName(value: string) {
  return value.replace(/[^\p{L}\s'-]/gu, "").slice(0, DISPLAY_NAME_MAX_LENGTH);
}

async function loadReminders(): Promise<Reminders> {
  try {
    const prefs = await getNotificationPreferences();
    return {
      daily_content_reminder: prefs.daily_content_reminder,
      survey_unlocked_reminder: prefs.survey_unlocked_reminder,
      daily_survey_reminder: prefs.daily_survey_reminder,
    };
  } catch (error) {
    console.error("Failed to load notification preferences:", error);
    throw error;
  }
}

function ToggleSwitch({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>

      <button
        type="button"
        id={id}
        aria-label={label}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${
          checked ? "bg-brand-blue" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [success, setSuccess] = useState(false);
  const { submitting, error, run } = useFormSubmit("Failed to change password");
  const [showForgotModal, setShowForgotModal] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(false);
    void run(async () => {
      // changePassword stores the replacement token the server issues.
      await changePassword({ current_password: currentPassword, new_password: newPassword });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
    });
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">Password changed successfully.</p>}

        <input
          type="password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Current password"
          className={FIELD_CLASS}
        />
        <button
          type="button"
          onClick={() => setShowForgotModal(true)}
          className="-mt-1 w-fit text-sm text-brand-blue hover:underline"
        >
          Forgot your current password?
        </button>
        <input
          type="password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password (min. 8 characters)"
          className={FIELD_CLASS}
        />

        <Button
          type="submit"
          disabled={submitting}
          variant="primary" size={null} className="w-fit rounded-lg px-4 py-2 text-sm font-semibold hover:bg-brand-blue-dark disabled:opacity-60"
        >
          {submitting ? "Changing..." : "Change Password"}
        </Button>
      </form>

      <Modal isOpen={showForgotModal} onClose={() => setShowForgotModal(false)} title="Forgot your password?">
        <div className="flex flex-col gap-6 text-center">
          <p className="text-md text-ink">
            Please email admin Sarah at{" "}
            <a
              href={`mailto:${ADMIN_EMAIL}?subject=Password%20reset%20request`}
              className="font-semibold text-brand-blue hover:underline"
            >
              {ADMIN_EMAIL}
            </a>{" "}
            to reset your password.
          </p>
          <Button
            type="button"
            onClick={() => setShowForgotModal(false)}
            variant="dark" size="lg"
          >
            Close
          </Button>
        </div>
      </Modal>
    </>
  );
}

export default function ProfilePage() {
  const { user, isLoading: authLoading, updateUser } = useRequireAuth();

  // null means "the user hasn't edited the field yet", so we show the saved name.
  // Once they type (even to clear the field), their edit takes over.
  const [editedDisplayName, setEditedDisplayName] = useState<string | null>(null);
  const savedDisplayName = user?.display_name ?? "";
  const displayName = editedDisplayName ?? savedDisplayName;

  // The same idea for the reminder toggles: unsaved edits sit on top of the saved values.
  const { data: savedReminders, setData: setSavedReminders } = useAsync(loadReminders, [user], DEFAULT_REMINDERS, {
    enabled: !authLoading && !!user,
  });
  const [editedReminders, setEditedReminders] = useState<Partial<Reminders>>({});
  const reminders: Reminders = { ...savedReminders, ...editedReminders };

  const [status, setStatus] = useState<SaveStatus>("idle");
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);

  const signedInName = user?.full_name?.trim() || "User";
  const isGoogleUser = user?.auth_provider === "google";

  const displayNameChanged = displayName !== savedDisplayName;
  const remindersChanged = REMINDER_TOGGLES.some(({ key }) => reminders[key] !== savedReminders[key]);
  const hasChanges = displayNameChanged || remindersChanged;

  async function handleSave() {
    setStatus("saving");
    try {
      if (displayNameChanged) await updateProfile({ display_name: displayName });
      if (remindersChanged) await updateNotificationPreferences(reminders);

      setStatus("success");
      updateUser({ display_name: displayName });
      setSavedReminders(reminders);
      setEditedReminders({});
      setEditedDisplayName(null);
    } catch (error) {
      console.error("Failed to save profile:", error);
      setStatus("error");
    }
  }

  return (
    <>
      <Head>
        <title>{pageTitle("Profile")}</title>
      </Head>

      <AppShell
        rightRail={
          <div className="space-y-4">
            <UpcomingSession />
            <NotificationsPanel />
          </div>
        }
      >
        <div className="flex min-w-0 flex-col gap-4">
          <PageHeader title="Your Profile" description="Manage how you appear in the forum, your reminders and your password" />

          <Card className="overflow-hidden">
            <div className="flex items-center gap-4 border-b border-gray-100 p-6">
              <UserAvatar
                avatarUrl={user?.avatar_url}
                fullName={signedInName}
                size={64}
                className="border border-gray-200 bg-white"
              />

              <div>
                <h2 className="text-lg font-semibold text-ink">{signedInName}</h2>
                <p className="mt-0.5 text-sm text-muted">Profile photo powered by Gravatar</p>
                <a
                  href="https://gravatar.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-brand-blue hover:underline"
                >
                  Change on gravatar.com →
                </a>
              </div>
            </div>

            <div className="border-b border-gray-100 p-6">
              <label htmlFor="displayName" className="mb-1 block text-sm font-medium text-ink">
                Display Name
              </label>
              <input
                id="displayName"
                type="text"
                placeholder="(optional)"
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                value={displayName}
                onChange={(event) => setEditedDisplayName(sanitizeDisplayName(event.target.value))}
                className={`w-full placeholder-gray-400 focus:border-transparent ${FIELD_CLASS}`}
              />
              <p className="mt-1.5 text-sm text-muted">
                This name will be shown in forums. Admins will still see your registered name.
              </p>
            </div>

            <div className="border-b border-gray-100 p-6">
              <span className="mb-1 block text-sm font-medium text-ink">Email</span>
              <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                <span className="text-sm text-muted">{user?.email ?? ""}</span>
                <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-muted">
                  <LockIcon className="h-3.5 w-3.5" />
                  Locked
                </span>
              </div>
            </div>

            <div className="border-b border-gray-100 p-6">
              <h2 className="mb-2 text-sm font-medium text-ink">Notification Preferences</h2>
              <div className="space-y-3">
                {REMINDER_TOGGLES.map(({ key, id, label, description }) => (
                  <ToggleSwitch
                    key={key}
                    id={id}
                    label={label}
                    description={description}
                    checked={reminders[key]}
                    onChange={(value) => setEditedReminders((prev) => ({ ...prev, [key]: value }))}
                  />
                ))}
              </div>
              <button type="button" onClick={() => setShowNotificationModal(true)} className={`mt-4 ${OUTLINE_BUTTON_CLASS}`}>
                Set up notifications
              </button>
            </div>

            <div className="border-b border-gray-100 p-6">
              <h2 className="mb-2 text-sm font-medium text-ink">Password</h2>
              {isGoogleUser ? (
                <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
                  You&apos;re signed in with Google. To change your password, visit your{" "}
                  <a
                    href="https://myaccount.google.com/security"
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-blue hover:underline"
                  >
                    Google Account settings
                  </a>
                  .
                </div>
              ) : (
                <>
                  <button type="button" onClick={() => setShowPasswordForm((prev) => !prev)} className={OUTLINE_BUTTON_CLASS}>
                    {showPasswordForm ? "Cancel" : "Reset Password"}
                  </button>
                  {showPasswordForm && <ChangePasswordForm />}
                </>
              )}
            </div>

            <div className="p-6 pt-0">
              <Button
                type="button"
                onClick={handleSave}
                disabled={status === "saving" || !hasChanges}
                variant="primary" size={null} className="w-full rounded-lg py-3 text-sm font-semibold hover:bg-brand-blue-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "saving" ? "Saving..." : "Save Changes"}
              </Button>
              {status === "success" && <p className="mt-2 text-sm text-green-600">Changes saved.</p>}
              {status === "error" && (
                <p className="mt-2 text-sm text-red-600">
                  Couldn&apos;t save your changes. Check your connection and try again.
                </p>
              )}
            </div>
          </Card>
        </div>
      </AppShell>

      <NotificationSetupModal isOpen={showNotificationModal} onClose={() => setShowNotificationModal(false)} />
    </>
  );
}
