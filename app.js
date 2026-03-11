/* ============================================================
   HUSHLY — app.js
   All Firebase / Firestore logic preserved exactly.
   ============================================================ */

// ---- Firebase Init ----
firebase.initializeApp(firebaseConfig);
const db        = firebase.firestore();
const auth      = firebase.auth();
const messaging = firebase.messaging();

// ---- Global State ----
let currentUser  = null;
let userProfile  = null;
let currentTab   = null;
let isGold       = false;
let feedListener = null;
let replyData    = null;
let isTopFilter  = false;

/* ============================================================
   AUTH
   ============================================================ */
auth.onAuthStateChanged(async (user) => {
    currentUser = user;

    if (user) {
        document.getElementById('auth-btn').innerText = 'Logout';

        // Show Admin button if matched
        if (typeof ADMIN_EMAIL !== 'undefined' && user.email === ADMIN_EMAIL) {
            document.getElementById('admin-btn').style.display = 'block';
        }

        const doc = await db.collection('users').doc(user.uid).get();

        if (!doc.exists) {
            document.getElementById('modal-profile').style.display = 'flex';
        } else {
            userProfile = doc.data();

            // Show identity card
            const profileCard = document.getElementById('my-profile-card');
            if (profileCard) {
                profileCard.style.display = 'flex';
                document.getElementById('my-anon-id').innerText = userProfile.anonymousId || 'Unknown';
            }

            // Generate invite code if missing
            if (!userProfile.myInviteCode) {
                const baseName = user.displayName
                    ? user.displayName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase()
                    : 'USR';
                const myCode = baseName + Math.floor(100 + Math.random() * 900);
                await db.collection('users').doc(user.uid).update({ myInviteCode: myCode });
                userProfile.myInviteCode = myCode;
            }

            if (!sessionStorage.getItem('rulesAgreed')) {
                document.getElementById('modal-rules').style.display = 'flex';
            }
        }

        document.getElementById('modal-login').style.display = 'none';

    } else {
        document.getElementById('auth-btn').innerText = 'Login';
        document.getElementById('admin-btn').style.display = 'none';
        userProfile = null;
    }

    updateInputState();
});

/* ============================================================
   INPUT STATE
   ============================================================ */
function updateInputState() {
    const input   = document.getElementById('chat-input');
    const sendBtn = document.querySelector('.send-btn');
    if (!input) return;

    if (!currentUser) {
        input.placeholder = 'Please login to chat';
        input.disabled    = true;
        if (sendBtn) sendBtn.style.opacity = '0.5';
    } else {
        input.placeholder = 'Type a message…';
        input.disabled    = false;
        if (sendBtn) sendBtn.style.opacity = '1';
    }
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function enterChannel(channelKey, title) {
    hideAllViews();
    currentTab = channelKey;

    document.getElementById('feed-view').style.display   = 'block';
    document.getElementById('filter-btn').style.display  = 'block';
    document.getElementById('channel-title').innerText   = title;
    document.getElementById('channel-title').style.display = 'block';
    document.getElementById('back-btn').style.display    = 'block';
    document.getElementById('logo-text').style.display   = 'none';

    // Hide chat bar in News unless admin
    const chatBar = document.getElementById('chat-bar');
    const isAdmin = typeof ADMIN_EMAIL !== 'undefined' && currentUser && currentUser.email === ADMIN_EMAIL;

    if (channelKey === 'news' && !isAdmin) {
        chatBar.style.display = 'none';
    } else {
        chatBar.style.display = 'flex';
    }

    if (window.history && window.history.pushState) {
        window.history.pushState({ page: 'channel' }, title, '#' + channelKey);
    }

    loadFeed();
    updateInputState();
}

function hideAllViews() {
    document.getElementById('lobby-view').style.display  = 'none';
    document.getElementById('feed-view').style.display   = 'none';
    document.getElementById('admin-view').style.display  = 'none';
    document.getElementById('chat-bar').style.display    = 'none';
    document.getElementById('filter-btn').style.display  = 'none';
    if (feedListener) feedListener();
}

function goHome(isPop) {
    if (!isPop && currentTab) {
        history.back();
        return;
    }
    hideAllViews();
    currentTab   = null;
    isTopFilter  = false;
    updateFilterBtnUI();
    document.getElementById('lobby-view').style.display    = 'flex';
    document.getElementById('logo-text').style.display     = 'block';
    document.getElementById('back-btn').style.display      = 'none';
    document.getElementById('channel-title').style.display = 'none';
}

window.addEventListener('popstate', () => goHome(true));

/* ============================================================
   ADMIN PANEL
   ============================================================ */
function openAdminPanel() {
    hideAllViews();
    document.getElementById('admin-view').style.display      = 'block';
    document.getElementById('channel-title').innerText       = 'Dashboard';
    document.getElementById('channel-title').style.display   = 'block';
    document.getElementById('back-btn').style.display        = 'block';
    document.getElementById('logo-text').style.display       = 'none';
    loadAdminData();
}

async function loadAdminData() {
    if (!currentUser || currentUser.email !== ADMIN_EMAIL) return showToast('Access Denied');

    const tbody = document.getElementById('admin-table-body');
    tbody.innerHTML = '<tr><td colspan="4">Loading users…</td></tr>';

    // Count total users in background
    db.collection('users').get().then(fullSnap => {
        const el = document.getElementById('total-users-count');
        if (el) el.innerText = fullSnap.size;
    });

    const snap = await db.collection('users').orderBy('joinedAt', 'desc').limit(50).get();

    const users        = [];
    const deviceCounts = {};
    const ipCounts     = {};

    snap.forEach(doc => {
        const d = doc.data();
        users.push(d);
        if (d.deviceId)   deviceCounts[d.deviceId]   = (deviceCounts[d.deviceId]   || 0) + 1;
        if (d.ipAddress)  ipCounts[d.ipAddress]       = (ipCounts[d.ipAddress]     || 0) + 1;
    });

    tbody.innerHTML = '';
    users.forEach(u => {
        const isDeviceDup = deviceCounts[u.deviceId] > 1;
        const isIpDup     = ipCounts[u.ipAddress]    > 1;
        const isSuspect   = isDeviceDup || isIpDup;
        const rowClass    = isSuspect ? 'row-red' : 'row-green';

        const html = `
            <tr class="${rowClass}">
                <td>${u.name || 'User'}<br><small>${u.email}</small></td>
                <td><b>${u.inviteCount || 0}</b></td>
                <td>${u.deviceId ? u.deviceId.substring(0, 8) + '…' : 'N/A'} ${isDeviceDup ? '<span class="tag tag-dup">DUP</span>' : ''}</td>
                <td>${u.ipAddress || 'N/A'} ${isIpDup ? '<span class="tag tag-dup">DUP</span>' : ''}</td>
            </tr>
        `;
        tbody.insertAdjacentHTML('beforeend', html);
    });
}

/* ============================================================
   PROFILE SAVE
   ============================================================ */
async function saveProfile() {
    const btn          = document.querySelector('#modal-profile .modal-btn');
    const originalText = btn.innerText;

    try {
        const dept       = document.getElementById('dept-input').value.trim();
        const gender     = document.getElementById('gender-select').value;
        const referInput = document.getElementById('refer-input').value.trim().toUpperCase();

        if (!dept || !gender) return showToast('Please fill all fields');

        btn.innerText  = 'Saving…';
        btn.disabled   = true;

        let deviceId = localStorage.getItem('hush_device_id');
        if (!deviceId) {
            deviceId = 'DEV-' + Math.random().toString(36).substr(2, 9) + Date.now();
            localStorage.setItem('hush_device_id', deviceId);
        }

        let userIp = 'Unknown';
        try {
            const ipRes  = await fetch('https://api.ipify.org?format=json');
            const ipData = await ipRes.json();
            userIp = ipData.ip;
        } catch (e) { console.log('IP fetch failed'); }

        const baseName   = currentUser.displayName
            ? currentUser.displayName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase()
            : 'USR';
        const myCode     = baseName + Math.floor(100 + Math.random() * 900);
        const anonymousId = 'User-' + Math.floor(1000 + Math.random() * 9000);

        await db.collection('users').doc(currentUser.uid).set({
            email:       currentUser.email,
            name:        currentUser.displayName,
            dept,
            gender,
            anonymousId,
            myInviteCode: myCode,
            inviteCount:  0,
            joinedAt:     new Date(),
            deviceId,
            ipAddress:    userIp
        }, { merge: true });

        // Referral logic
        if (referInput) {
            try {
                const snap = await db.collection('users').where('myInviteCode', '==', referInput).limit(1).get();
                if (!snap.empty) {
                    const referrerData = snap.docs[0].data();
                    if (referrerData.deviceId === deviceId) {
                        showToast('🚫 Cannot refer yourself!');
                    } else {
                        await db.collection('users').doc(snap.docs[0].id).update({
                            inviteCount: firebase.firestore.FieldValue.increment(1)
                        });
                    }
                }
            } catch (referErr) { console.log('Referral skipped', referErr); }
        }

        userProfile = { dept, gender, anonymousId, myInviteCode: myCode, inviteCount: 0 };
        document.getElementById('modal-profile').style.display = 'none';
        document.getElementById('modal-rules').style.display   = 'flex';
        showToast('Profile saved!');

    } catch (e) {
        alert('Error: ' + e.message);
        btn.innerText = originalText;
        btn.disabled  = false;
    }
}

/* ============================================================
   FEED
   ============================================================ */
function toggleTopFilter() {
    isTopFilter = !isTopFilter;
    updateFilterBtnUI();
    loadFeed();
}

function updateFilterBtnUI() {
    const btn = document.getElementById('filter-btn');
    if (btn) btn.classList.toggle('active', isTopFilter);
}

function loadFeed() {
    const feedDiv    = document.getElementById('feed-content');
    const feedLoader = document.getElementById('feed-loader');
    feedDiv.innerHTML = '';
    if (feedLoader) feedLoader.style.display = 'block';

    if (feedListener) feedListener();

    let query = db.collection('messages').where('category', '==', currentTab);

    if (isTopFilter) {
        // Client-side sort — avoids needing a Firestore composite index
        query = query.orderBy('timestamp', 'asc').limitToLast(200);
    } else {
        query = query.orderBy('timestamp', 'asc').limitToLast(100);
    }

    feedListener = query.onSnapshot(snap => {
        if (feedLoader) feedLoader.style.display = 'none';

        // Smart update: only likes changed — update in place, no re-render
        const isJustUpdates = !snap.empty && snap.docChanges().every(c => c.type === 'modified');


        if (isJustUpdates) {
            snap.docChanges().forEach(change => {
                if (change.type !== 'modified') return;
                const data = change.doc.data();
                const card = document.getElementById('msg-' + change.doc.id);
                if (!card) return;

                const btn = card.querySelectorAll('.action-btn')[1];
                if (btn) {
                    const isUpvoted  = currentUser && data.upvotedBy && data.upvotedBy.includes(currentUser.uid);
                    btn.className    = `action-btn ${isUpvoted ? 'upvoted' : ''}`;
                    btn.innerHTML    = `<i class="${isUpvoted ? 'fas' : 'far'} fa-heart"></i> ${data.upvotes || 0}`;
                }
            });
            return;
        }

        // Detect if a new message arrived (for auto-scroll)
        let shouldScroll = false;
        snap.docChanges().forEach(change => { if (change.type === 'added') shouldScroll = true; });

        // Full re-render
        document.querySelectorAll('.msg-card:not(.pinned-card)').forEach(e => e.remove());

        if (snap.empty && document.querySelectorAll('.pinned-card').length === 0) {
            feedDiv.innerHTML = `<div style="text-align:center; color:#94A3B8; margin-top:40px; font-size:0.95rem;">No messages yet. Be the first! 👋</div>`;
        }

        let allDocs = [];
        snap.forEach(doc => allDocs.push(doc));

        // Top filter: sort by upvotes descending in JS — no Firestore index needed
        if (isTopFilter) {
            allDocs.sort((a, b) => (b.data().upvotes || 0) - (a.data().upvotes || 0));
        }

        allDocs.forEach(doc => {
            if (!doc.data().isPinned || isTopFilter) {
                renderMessage(doc.data(), doc.id, feedDiv);
            }
        });

        if (!isTopFilter && shouldScroll) {
            setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 100);
        }
    });
}

/* ============================================================
   RENDER MESSAGE
   ============================================================ */
function renderMessage(msg, id, container) {
    const isMe    = currentUser && msg.senderUid === currentUser.uid;
    const isAdmin = typeof ADMIN_EMAIL !== 'undefined' && currentUser && currentUser.email === ADMIN_EMAIL;

    const delBtn   = isAdmin
        ? `<i class="fas fa-trash" onclick="deleteMsg('${id}')" style="color:#EF4444; cursor:pointer;"></i>`
        : '';

    const upvotes   = msg.upvotes || 0;
    const isUpvoted = currentUser && msg.upvotedBy && msg.upvotedBy.includes(currentUser.uid);
    const heartIcon = isUpvoted ? 'fas fa-heart' : 'far fa-heart';
    const heartClass = isUpvoted ? 'upvoted' : '';

    // Reply preview
    let replyHtml = '';
    if (msg.replyToText) {
        replyHtml = `
            <div class="reply-preview" onclick="scrollToMsg('${msg.replyToId}')">
                <b>${msg.replyToName}</b>: ${msg.replyToText}
            </div>`;
    }

    // Badges
    let badges = '';
    if (msg.isAdmin)  badges += `<span class="badge badge-admin">ADMIN</span>`;
    if (msg.isPremium) badges += `<span class="badge badge-gold">GOLD</span>`;
    if (msg.isPinned)  badges += `<span class="badge" style="background:#FDE047; color:#854D0E;">📌 PINNED</span>`;

    // Gender indicator
    let genderHtml = '';
    if (!msg.isAdmin) {
        if      (msg.userGender === 'Male')   genderHtml = `<span class="gender-box gender-m">M</span>`;
        else if (msg.userGender === 'Female') genderHtml = `<span class="gender-box gender-f">F</span>`;
        else                                  genderHtml = `<span class="gender-box gender-h">?</span>`;
    }

    // Timestamp
    let timeStr = 'Just now';
    if (msg.timestamp) {
        const date     = msg.timestamp.toDate();
        const datePart = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const timePart = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        timeStr = `${datePart} • ${timePart}`;
    }

    const html = `
        <div class="msg-card ${msg.isPremium ? 'premium' : ''} ${msg.isPinned ? 'pinned-card' : ''} ${isMe ? 'my-msg' : ''}"
             style="${msg.isPinned ? 'order:-1;' : ''}"
             id="msg-${id}">
            <div class="msg-header">
                <div class="user-id">
                    ${isMe ? 'You' : (msg.anonymousId || 'User')}
                    ${genderHtml} ${badges}
                </div>
                ${delBtn}
            </div>
            ${replyHtml}
            <div class="msg-text">${linkify(msg.text)}</div>
            <div class="msg-actions">
                <span class="msg-time">${timeStr}</span>
                <button class="action-btn" onclick="replyToMsg('${id}', '${escapeHtml(msg.text)}', '${msg.anonymousId}')">
                    <i class="fas fa-reply"></i>
                </button>
                <button class="action-btn ${heartClass}" onclick="toggleUpvote('${id}')">
                    <i class="${heartIcon}"></i> ${upvotes}
                </button>
            </div>
        </div>
    `;

    if (msg.isPinned && !isTopFilter) {
        container.insertAdjacentHTML('afterbegin', html);
    } else {
        container.insertAdjacentHTML('beforeend', html);
    }
}

/* ============================================================
   UPVOTE
   ============================================================ */
function toggleUpvote(id) {
    if (!currentUser) return showToast('Login to vote!');

    const card = document.getElementById(`msg-${id}`);
    if (!card) return;

    const heartEl = card.querySelector('.action-btn .fa-heart');
    if (!heartEl) return;
    const btn        = heartEl.parentElement;
    const isLikedNow = btn.classList.contains('upvoted');
    let count        = parseInt(btn.innerText) || 0;

    // Optimistic UI update
    if (isLikedNow) {
        btn.classList.remove('upvoted');
        btn.innerHTML = `<i class="far fa-heart"></i> ${Math.max(0, count - 1)}`;
    } else {
        btn.classList.add('upvoted');
        btn.innerHTML = `<i class="fas fa-heart"></i> ${count + 1}`;
    }

    // Persist to Firestore
    const docRef = db.collection('messages').doc(id);
    db.runTransaction(async (t) => {
        const doc = await t.get(docRef);
        if (!doc.exists) return;

        const data      = doc.data();
        const uid       = currentUser.uid;
        let upvotedBy   = data.upvotedBy || [];
        let upvotes     = data.upvotes   || 0;

        if (upvotedBy.includes(uid)) {
            upvotedBy = upvotedBy.filter(u => u !== uid);
            upvotes--;
        } else {
            upvotedBy.push(uid);
            upvotes++;
        }
        t.update(docRef, { upvotes, upvotedBy });
    }).catch(err => console.error('Like failed:', err));
}

/* ============================================================
   REPLY
   ============================================================ */
function replyToMsg(id, text, author) {
    if (!currentUser) return showToast('Login to reply!');
    replyData = { id, text: text.substring(0, 50) + '…', author };
    document.getElementById('reply-context').style.display = 'flex';
    document.getElementById('reply-to-name').innerText     = author;
    document.getElementById('chat-input').focus();
}

function cancelReply() {
    replyData = null;
    document.getElementById('reply-context').style.display = 'none';
}

function scrollToMsg(id) {
    const el = document.getElementById('msg-' + id);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-msg');
        setTimeout(() => el.classList.remove('highlight-msg'), 2000);
    } else {
        showToast('Message not loaded nearby');
    }
}

/* ============================================================
   SEND MESSAGE
   ============================================================ */
function sendMessage() {
    const input = document.getElementById('chat-input');
    const text  = input.value.trim();
    if (!text) return;
    if (!currentUser) return showToast('Please login!');

    const badWords = ['fuck', 'punda', 'otha', 'dick', 'bitch', 'koothi', 'mairu', 'soothu', 'oombu', 'pundai', 'poolu', 'sunni'];
    if (badWords.some(w => text.toLowerCase().includes(w))) return showToast('🚫 Keep it clean!');

    if (!userProfile) {
        document.getElementById('modal-profile').style.display = 'flex';
        return;
    }

    const payload = {
        text,
        category:  currentTab,
        isPremium: isGold,
        isAdmin:   typeof ADMIN_EMAIL !== 'undefined' && currentUser.email === ADMIN_EMAIL,
        userDept:  userProfile.dept,
        userGender: userProfile.gender,
        anonymousId: userProfile.anonymousId,
        senderUid: currentUser.uid,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        upvotes:   0,
        upvotedBy: [],
        isPinned:  false
    };

    if (replyData) {
        payload.replyToId   = replyData.id;
        payload.replyToName = replyData.author;
        payload.replyToText = replyData.text;
        cancelReply();
    }

    if (isGold) {
        startPayment(10, () => {
            db.collection('messages').add(payload);
            input.value = '';
            toggleGold();
        });
    } else {
        db.collection('messages').add(payload);
        input.value = '';
    }
}

/* ============================================================
   PAYMENTS (Razorpay)
   ============================================================ */
function startPayment(amt, cb) {
    if (typeof Razorpay === 'undefined') return showToast('Loading payment…');
    new Razorpay({
        key:      RAZORPAY_KEY,
        amount:   amt * 100,
        currency: 'INR',
        name:     'Hushly',
        handler:  cb,
        theme:    { color: '#0F172A' }
    }).open();
}

/* ============================================================
   UTILS
   ============================================================ */
function deleteMsg(id) {
    if (confirm('Delete this message?')) db.collection('messages').doc(id).delete();
}

function handleAuth() {
    currentUser ? auth.signOut() : document.getElementById('modal-login').style.display = 'flex';
}

function googleLogin() {
    auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
}

function acceptRules() {
    sessionStorage.setItem('rulesAgreed', 'true');
    document.getElementById('modal-rules').style.display = 'none';
}

function toggleGold() {
    isGold = !isGold;
    document.getElementById('gold-btn').classList.toggle('active', isGold);
    showToast(isGold ? '⭐ Gold Mode ON' : 'Gold Mode off');
}

function donateMoney() {
    startPayment(50, () => showToast('Thank you! ❤️'));
}

function linkify(text) {
    return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function escapeHtml(text) {
    return text.replace(/'/g, '&apos;').replace(/"/g, '&quot;');
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText   = msg;
    t.className   = 'show';
    setTimeout(() => { t.className = ''; }, 3000);
}

/* ============================================================
   PWA — INSTALL PROMPT
   ============================================================ */
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('install-container').style.display = 'flex';
});

async function installApp() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') document.getElementById('install-container').style.display = 'none';
    deferredPrompt = null;
}

window.addEventListener('appinstalled', () => {
    document.getElementById('install-container').style.display = 'none';
    deferredPrompt = null;
});
