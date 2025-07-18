self.addEventListener('push', function (event) {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(
      data.title || 'Motion Detected!',
      {
        body: data.body || 'Motion was detected by your camera.',
        icon: '/icon.png',
        data: data.data // <-- Pass the custom data object here!
      }
    )
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  let url = event.notification.data && event.notification.data.streamUrl;
  if (!url && event.notification.data && event.notification.data.FCM_MSG && event.notification.data.FCM_MSG.data) {
    url = event.notification.data.FCM_MSG.data.streamUrl;
  }
  if (!url && event.notification.data && event.notification.data.click_action) {
    url = event.notification.data.click_action;
  }
  url = url || 'https://gander.onl/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let client of windowClients) {
        if (client.url.startsWith('https://gander.onl')) {
          client.focus();
          // Always navigate to the correct stream URL
          client.navigate(url);
          return;
        }
      }
      clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', function (event) {
  const url = new URL(event.request.url);

  // Aggressively cache all recording thumbnails except latest.jpg
  if (
    url.pathname.includes('/thumbnails/') &&
    !url.pathname.endsWith('latest.jpg')
  ) {
    event.respondWith(
      caches.open('recording-thumbnails').then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) {
          return cached;
        }
        const response = await fetch(event.request);
        if (response.ok) {
          cache.put(event.request, response.clone());
        }
        return response;
      })
    );
  }
});
