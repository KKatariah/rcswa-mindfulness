import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Navbar from "@/components/main/Navbar";
import Sidebar from "@/components/main/Sidebar";
import NextSession from "@/components/modules/NextSession";
import { LockIcon } from "@/components/ui/icons";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/context/AuthContext";

type NotificationPreferences = {
  dailyContentReminder: boolean;
  surveyUnlockedReminder: boolean;
  dailySurveyCompletionReminder: boolean;
};

type UserProfile = {
  username: string;
  displayName: string;
  email: string;
  notifications: NotificationPreferences;
};

type SaveStatus = "idle" | "saving" | "success" | "error";

const INITIAL_PROFILE: UserProfile = {
  username: "Username",
  displayName: "",
  email: "user@example.com",
  notifications: {
    dailyContentReminder: true,
    surveyUnlockedReminder: false,
    dailySurveyCompletionReminder: false,
  },
};

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
        <label htmlFor={id} className="block text-sm font-medium text-gray-900">
          {label}
        </label>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>

      <button
        type="button"
        id={id}
        aria-label={label}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className={[
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200",
          checked ? "bg-blue-500" : "bg-gray-300",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
            checked ? "translate-x-5" : "translate-x-1",
          ].join(" ")}
        />
      </button>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile>(INITIAL_PROFILE);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/");
    }
  }, [authLoading, user, router]);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const signedInName = user?.full_name?.trim() || profile.username;

  const updateNotification = (key: keyof NotificationPreferences, value: boolean) => {
    setProfile((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, [key]: value },
    }));
  };

  const handleSave = async () => {
    setStatus("saving");

    try {
      const res = await fetch("/api/profile/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: profile.displayName || null,
          notifications: {
            daily_content_reminder: profile.notifications.dailyContentReminder,
            survey_unlocked_reminder: profile.notifications.surveyUnlockedReminder,
            daily_survey_completion_reminder: profile.notifications.dailySurveyCompletionReminder,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`Save failed: ${res.status}`);
      }

      setStatus("success");
    } catch {
      setStatus("error");
    }
  };

  return (
    <>
      <Head>
        <title>Profile</title>
      </Head>

      <div
        className="min-h-screen bg-cover bg-center bg-fixed bg-no-repeat"
        style={{ backgroundImage: "url(/images/module-background.jpg)" }}
      >
        <div className="sticky top-0 z-30 h-20 bg-black/30 backdrop-blur-md lg:h-24">
          <Navbar />
        </div>

        <div className="mx-auto grid max-w-[1920px] items-start gap-6 p-4 md:grid-cols-[240px_minmax(0,1fr)] md:p-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
          <Sidebar responsive />

          <main className="flex min-w-0 flex-col gap-6">
            <div className="overflow-hidden rounded-[10px] border border-gray-200 bg-white shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
              <div className="flex items-center gap-4 border-b border-gray-100 p-6">
                <UserAvatar
                  email={user?.email ?? profile.email}
                  fullName={signedInName}
                  size={64}
                  className="border border-gray-200 bg-white"
                />

                <div>
                  <h1 className="text-lg font-semibold text-gray-900">{signedInName}</h1>
                  <p className="mt-0.5 text-sm text-gray-500">Profile photo powered by Gravatar</p>
                  <a
                    href="https://gravatar.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-blue-500 hover:underline"
                  >
                    Change on gravatar.com →
                  </a>
                </div>
              </div>

              <div className="border-b border-gray-100 p-6">
                <label htmlFor="displayName" className="mb-1 block text-sm font-medium text-gray-900">
                  Display Name
                </label>
                <input
                  id="displayName"
                  type="text"
                  placeholder="(optional)"
                  value={profile.displayName}
                  onChange={(event) =>
                    setProfile((prev) => ({ ...prev, displayName: event.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1.5 text-sm text-gray-500">
                  This name will be shown in forums. Admins will still see your registered name.
                </p>
              </div>

              <div className="border-b border-gray-100 p-6">
                <span className="mb-1 block text-sm font-medium text-gray-900">Email</span>
                <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                  <span className="text-sm text-gray-500">{profile.email}</span>
                  <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    <LockIcon className="h-3.5 w-3.5" />
                    Locked
                  </span>
                </div>
              </div>

              <div className="border-b border-gray-100 p-6">
                <h2 className="mb-2 text-sm font-medium text-gray-900">Notification Preferences</h2>
                <div className="space-y-3">
                  <ToggleSwitch
                    id="dailyContentReminder"
                    label="Daily content reminder"
                    description="Notify me daily around 5pm to complete any unviewed module content"
                    checked={profile.notifications.dailyContentReminder}
                    onChange={(value) => updateNotification("dailyContentReminder", value)}
                  />
                  <ToggleSwitch
                    id="surveyUnlockedReminder"
                    label="New survey unlocked reminder"
                    description="Notify me when a module's survey is unlocked"
                    checked={profile.notifications.surveyUnlockedReminder}
                    onChange={(value) => updateNotification("surveyUnlockedReminder", value)}
                  />
                  <ToggleSwitch
                    id="dailySurveyCompletionReminder"
                    label="Daily survey completion reminder"
                    description="Notify me daily around 5pm to submit any uncompleted surveys."
                    checked={profile.notifications.dailySurveyCompletionReminder}
                    onChange={(value) => updateNotification("dailySurveyCompletionReminder", value)}
                  />
                </div>
              </div>

              <div className="border-b border-gray-100 p-6">
                <h2 className="mb-2 text-sm font-medium text-gray-900">Password</h2>
                <button
                  type="button"
                  className="rounded-lg border border-blue-500 px-4 py-2 text-sm font-medium text-blue-500 transition-colors hover:bg-blue-50"
                >
                  Reset Password
                </button>
              </div>

              <div className="p-6 pt-0">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={status === "saving"}
                  className="w-full rounded-lg bg-blue-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-60"
                >
                  {status === "saving" ? "Saving..." : "Save Changes"}
                </button>
                {status === "success" && <p className="mt-2 text-sm text-green-600">Changes saved.</p>}
                {status === "error" && (
                  <p className="mt-2 text-sm text-red-600">
                    Couldn't save your changes. Check your connection and try again.
                  </p>
                )}
              </div>
            </div>
          </main>

          <div className="w-full xl:pt-0">
            <NextSession
              moduleTitle="Module Week 3"
              startsAt="2028-10-24T10:00:00+08:00"
              dateLabel="Tue, Oct 24"
              timeLabel="10:00 AM"
            />
          </div>
        </div>
      </div>
    </>
  );
}
