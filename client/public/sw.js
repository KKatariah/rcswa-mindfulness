self.addEventListener("push", (event) => {
  let data = {
    title: "Mindfulness App",
    body: "You have a new notification.",
    url: "/",
  };

  if (event.data) {
    try {
      const payload = event.data.json();

      data = {
        title: payload.title || data.title,
        body: payload.body || data.body,
        url: payload.url || data.url,
      };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
  body: data.body,
  data: {
    url: data.url,
  },
};

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }

        return clients.openWindow(url);
      })
  );
});