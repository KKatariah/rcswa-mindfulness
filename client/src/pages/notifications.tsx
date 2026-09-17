import NotificationManager from "@/components/notifications/NotificationManager";

export default function NotificationsPage() {
  return (
    <main style={{ padding: "40px" }}>
      <h1>Notifications</h1>
      <p>Enable browser push notifications for this account.</p>

      <NotificationManager />
    </main>
  );
}