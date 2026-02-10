const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const messaging = admin.messaging();

async function runDailyPush() {
    console.log("🤖 Robot Waking Up...");
    const yesterday = new Date(Date.now() - 86400000);
    const snapshot = await db.collection('messages').where('timestamp', '>', yesterday).get();

    if (snapshot.empty) return console.log("😴 No messages today.");

    let hasNews = false;
    snapshot.forEach(doc => { if (doc.data().category === 'news') hasNews = true; });

    const notification = hasNews 
        ? { title: "📢 Important News", body: "Admin posted an announcement." }
        : { title: "👀 Someone posted something...", body: "Check out the latest secrets." };

    const usersSnap = await db.collection('users').get();
    let batch = [];

    usersSnap.forEach(doc => {
        const u = doc.data();
        if (u.fcmToken) {
            batch.push({
                token: u.fcmToken,
                notification: notification,
                data: { url: 'https://hushly.fun', click_action: 'FLUTTER_NOTIFICATION_CLICK' }
            });
        }
    });

    if (batch.length > 0) {
        console.log(`🚀 Sending to ${batch.length} users.`);
        await messaging.sendEach(batch);
    }
}
runDailyPush();
