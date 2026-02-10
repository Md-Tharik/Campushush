const admin = require('firebase-admin');

// Initialize
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const messaging = admin.messaging();

async function runDailyPush() {
    console.log("🤖 Robot Waking Up...");

    const now = new Date();
    const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // Last 24 hours

    // 1. CHECK FOR ACTIVITY
    const snapshot = await db.collection('messages')
        .where('timestamp', '>', yesterday)
        .get();

    if (snapshot.empty) {
        console.log("😴 No messages today.");
        return; // Logic finishes here
    }

    // 2. DECIDE MESSAGE
    let hasNews = false;
    snapshot.forEach(doc => {
        if (doc.data().category === 'news') hasNews = true;
    });

    const notification = hasNews 
        ? { title: "📢 Important News", body: "Admin posted an announcement." }
        : { title: "👀 Someone posted something...", body: "Check out the latest secrets." };

    // 3. GET USERS & SEND
    const usersSnap = await db.collection('users').get();
    let batch = [];

    usersSnap.forEach(doc => {
        const u = doc.data();
        if (u.fcmToken) {
            batch.push({
                token: u.fcmToken,
                notification: notification,
                data: { 
                    url: 'https://hushly.fun', 
                    click_action: 'FLUTTER_NOTIFICATION_CLICK' 
                }
            });
        }
    });

    if (batch.length > 0) {
        console.log(`🚀 Sending to ${batch.length} users.`);
        const response = await messaging.sendEach(batch);
        console.log(`✅ Success: ${response.successCount}`);
    } else {
        console.log("🤷 No users with tokens found.");
    }
}

// --- THE FIX IS HERE ---
runDailyPush()
    .then(() => {
        console.log("🏁 Robot Finished. Exiting.");
        process.exit(0); // FORCE KILL THE PROCESS
    })
    .catch((error) => {
        console.error("❌ Error:", error);
        process.exit(1); // FORCE KILL WITH ERROR
    });
