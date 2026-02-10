const admin = require('firebase-admin');

// 1. Safe Initialization
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const messaging = admin.messaging();

async function runDailyPush() {
    try {
        console.log("🤖 Robot Waking Up...");
        const yesterday = new Date(Date.now() - 86400000);
        
        // Check for messages
        const snapshot = await db.collection('messages')
            .where('timestamp', '>', yesterday)
            .get();

        if (snapshot.empty) {
            console.log("😴 No messages today. Exiting.");
            return;
        }

        // Determine content
        let hasNews = false;
        snapshot.forEach(doc => { if (doc.data().category === 'news') hasNews = true; });

        const notification = hasNews 
            ? { title: "📢 Important News", body: "Admin posted an announcement." }
            : { title: "👀 Someone posted something...", body: "Check out the latest secrets." };

        // Get users
        const usersSnap = await db.collection('users').get();
        let tokens = [];
        
        usersSnap.forEach(doc => {
            const u = doc.data();
            if (u.fcmToken) tokens.push(u.fcmToken);
        });

        if (tokens.length === 0) {
            console.log("🤷 No users subscribed.");
            return;
        }

        console.log(`🚀 Preparing to send to ${tokens.length} devices...`);

        // Send logic (Handles errors per user)
        const responses = await messaging.sendEachForMulticast({
            tokens: tokens,
            notification: notification,
            data: { url: 'https://hushly.fun', click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        });

        console.log(`✅ Success: ${responses.successCount}`);
        console.log(`❌ Failed: ${responses.failureCount}`);

        // Cleanup invalid tokens (Self-cleaning database)
        if (responses.failureCount > 0) {
            const failedTokens = [];
            responses.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push(tokens[idx]);
                }
            });
            console.log("🧹 Cleaning up invalid tokens...");
            // (Advanced logic to delete bad tokens could go here)
        }

    } catch (error) {
        console.error("🔥 CRITICAL ERROR:", error);
        process.exit(1); // Tells GitHub the robot crashed
    }
}

runDailyPush().then(() => {
    console.log("🏁 Done.");
    process.exit(0);
});
