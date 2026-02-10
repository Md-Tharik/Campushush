importScripts('https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyCQP3EGr36pzlJuuh0zW6aIa7kuenPrHCk",
    projectId: "srasc-campus-hush",
    messagingSenderId: "728810926219",
    appId: "1:728810926219:web:c2e547c072156dbab3248e"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: 'https://cdn-icons-png.flaticon.com/512/1077/1077114.png',
    data: { url: 'https://hushly.fun' } 
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
