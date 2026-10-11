import Head from "next/head";
import NotificationManager from "@/components/notifications/NotificationManager";
import { pageTitle } from "@/lib/pageTitle";

export default function NotificationsPage() {
  return (
    <main style={{ padding: "40px" }}>
      <Head>
        <title>{pageTitle("Notifications")}</title>
      </Head>
      <h1>Notifications</h1>
      <p>Enable browser push notifications for this account.</p>

      <NotificationManager />
    </main>
  );
}