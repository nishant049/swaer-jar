    "use strict";

    const FIREBASE_CONFIG = {
      apiKey: "AIzaSyB8wXYEBY7-Z4WM4qFSj98QZNPY3y6awj4",
    authDomain: "swear-jar-app-60623.firebaseapp.com",
    projectId: "swear-jar-app-60623",
    storageBucket: "swear-jar-app-60623.firebasestorage.app",
    messagingSenderId: "999106249446",
    appId: "1:999106249446:web:7c2dea8a8fb62c0cc23127"
    };

    const STORAGE_KEYS = {
      myCount: "myCount",
      herCount: "herCount",
      totalCount: "totalCount",
      fightHistory: "fightHistory",
      lastFightDate: "lastFightDate",
      soundEnabled: "soundEnabled"
    };

    const VOICE_LINES = [
      "Oops you did it again 😏",
      "Another one?! 😂",
      "Peace was never an option 😤",
      "This is getting expensive 💸"
    ];

    const STREAK_MILESTONES = [3, 7, 14, 30];
    const ONE_DAY = 24 * 60 * 60 * 1000;

    let appState = createEmptyState();
    let currentMode = localStorage.getItem("swearJarMode") || "local";
    let currentCoupleId = localStorage.getItem("swearJarCoupleId") || "";
    let currentUser = null;
    let auth = null;
    let db = null;
    let coupleRef = null;
    let unsubscribeCouple = null;
    let firebaseInitialized = false;
    let isSaving = false;
    let lastNewHistoryTimestamp = "";
    let activeAudio = null;
    let toastTimer = null;
    let previousCounts = { myCount: null, herCount: null, totalCount: null };
    let userHasInteracted = false;
    let suppressStreakCelebration = false;
    let coinAnimationLock = false;
    let isAuthOpen = false;

    const elements = {};

    document.addEventListener("DOMContentLoaded", () => {
      cacheElements();
      initializePreferences();
      setupAudio();
      bindEvents();
      initFirebase();
      loadData();
      updateUI();
      window.setInterval(updateUI, 60 * 1000);
    });

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js")
          .then(() => console.log("Service Worker Registered"))
          .catch((error) => console.warn("Service Worker registration failed:", error));
      });
    }

    function cacheElements() {
      elements.soundToggle = document.getElementById("soundToggle");
      elements.resetButton = document.getElementById("resetButton");
      elements.authPanel = document.querySelector(".auth-panel");
      elements.authToggle = document.getElementById("authToggle");
      elements.authToggleSummary = document.getElementById("authToggleSummary");
      elements.authPanelBody = document.getElementById("authPanelBody");
      elements.localModeButton = document.getElementById("localModeButton");
      elements.sharedModeButton = document.getElementById("sharedModeButton");
      elements.sharedControls = document.getElementById("sharedControls");
      elements.modeBadge = document.getElementById("modeBadge");
      elements.authStatus = document.getElementById("authStatus");
      elements.syncStatus = document.getElementById("syncStatus");
      elements.googleButton = document.getElementById("googleButton");
      elements.guestButton = document.getElementById("guestButton");
      elements.coupleIdInput = document.getElementById("coupleIdInput");
      elements.joinButton = document.getElementById("joinButton");
      elements.totalCount = document.getElementById("totalCount");
      elements.streakCount = document.getElementById("streakCount");
      elements.verdictText = document.getElementById("verdictText");
      elements.myCount = document.getElementById("myCount");
      elements.herCount = document.getElementById("herCount");
      elements.meButton = document.getElementById("meButton");
      elements.herButton = document.getElementById("herButton");
      elements.jarTarget = document.getElementById("jarTarget");
      elements.historyList = document.getElementById("historyList");
      elements.historyCount = document.getElementById("historyCount");
      elements.toast = document.getElementById("toast");
      elements.confettiLayer = document.getElementById("confettiLayer");
      elements.coinAudio = document.getElementById("coinAudio");
      elements.herAudio = document.getElementById("herAudio");
      elements.voiceAudio = document.getElementById("voiceAudio");
      elements.celebrationAudio = document.getElementById("celebrationAudio");
      elements.coupleIdInput.value = currentCoupleId;
    }

    function bindEvents() {
      elements.soundToggle.addEventListener("click", toggleSound);
      elements.resetButton.addEventListener("click", resetJar);
      elements.authToggle.addEventListener("click", toggleAuthPanel);
      elements.localModeButton.addEventListener("click", () => setMode("local"));
      elements.sharedModeButton.addEventListener("click", () => setMode("shared"));
      elements.googleButton.addEventListener("click", () => loginUser("google"));
      elements.guestButton.addEventListener("click", () => loginUser("anonymous"));
      elements.joinButton.addEventListener("click", connectToCouple);
      elements.meButton.addEventListener("click", () => addFight("me"));
      elements.herButton.addEventListener("click", () => addFight("her"));
      elements.coupleIdInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          connectToCouple();
        }
      });
    }

    function createEmptyState() {
      return {
        myCount: 0,
        herCount: 0,
        totalCount: 0,
        fightHistory: [],
        lastFightDate: null
      };
    }

    function initFirebase() {
      if (firebaseInitialized) {
        return true;
      }

      if (!hasFirebaseConfig()) {
        setAuthStatus("Paste Firebase config to unlock shared mode");
        return false;
      }

      if (!window.firebase) {
        setAuthStatus("Firebase CDN is unavailable");
        return false;
      }

      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(FIREBASE_CONFIG);
        }

        auth = firebase.auth();
        db = firebase.firestore();

        db.enablePersistence({ synchronizeTabs: true }).catch(() => {
          // Persistence is best-effort; real-time sync still works without it.
        });

        auth.onAuthStateChanged((user) => {
          currentUser = user || null;
          if (currentMode === "shared" && currentUser && currentCoupleId) {
            loadData();
          }
          updateUI();
        });

        firebaseInitialized = true;
        return true;
      } catch (error) {
        console.error("Firebase initialization failed:", error);
        setAuthStatus("Firebase could not start");
        return false;
      }
    }

    async function loginUser(method = "google") {
      if (!initFirebase()) {
        showToast("Shared mode needs Firebase config first.");
        updateUI();
        return null;
      }

      try {
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        setAuthStatus("Signing in...");

        if (method === "google") {
          const provider = new firebase.auth.GoogleAuthProvider();
          const result = await auth.signInWithPopup(provider);
          currentUser = result.user;
          showToast("Signed in with Google 💕");
        } else {
          const result = await auth.signInAnonymously();
          currentUser = result.user;
          showToast("Guest login ready 💕");
        }
      } catch (googleError) {
        if (method !== "google") {
          console.error("Anonymous sign-in failed:", googleError);
          setAuthStatus("Login failed");
          showToast("Login needs another try.");
          updateUI();
          return null;
        }

        try {
          const result = await auth.signInAnonymously();
          currentUser = result.user;
          showToast("Google was shy, guest login is ready 💕");
        } catch (anonymousError) {
          console.error("Anonymous fallback failed:", anonymousError);
          setAuthStatus("Login failed");
          showToast("Firebase Auth needs Google or Anonymous enabled.");
          updateUI();
          return null;
        }
      }

      updateUI();
      return currentUser;
    }

    async function loadData() {
      if (currentMode === "shared") {
        if (!initFirebase() || !currentUser || !currentCoupleId) {
          appState = createEmptyState();
          updateUI();
          return;
        }

        startRealtimeListener();
        updateUI();
        return;
      }

      if (unsubscribeCouple) {
        unsubscribeCouple();
        unsubscribeCouple = null;
      }

      coupleRef = null;
      appState = {
        myCount: readStoredNumber(STORAGE_KEYS.myCount),
        herCount: readStoredNumber(STORAGE_KEYS.herCount),
        totalCount: readStoredNumber(STORAGE_KEYS.totalCount),
        fightHistory: readStoredHistory(),
        lastFightDate: localStorage.getItem(STORAGE_KEYS.lastFightDate) || null
      };
      appState.totalCount = appState.myCount + appState.herCount;
      updateUI();
    }

    function startRealtimeListener() {
      if (!db || !currentCoupleId) {
        return;
      }

      if (unsubscribeCouple) {
        unsubscribeCouple();
        unsubscribeCouple = null;
      }

      coupleRef = db.collection("couples").doc(currentCoupleId);
      unsubscribeCouple = coupleRef.onSnapshot((snapshot) => {
        appState = snapshot.exists ? normalizeFirestoreData(snapshot.data()) : createEmptyState();
        updateUI();
      }, (error) => {
        console.error("Firestore listener failed:", error);
        setAuthStatus("Sync paused");
        showToast("Shared sync needs a connection.");
        updateUI();
      });
    }

    async function saveData() {
      appState.myCount = sanitizeCount(appState.myCount);
      appState.herCount = sanitizeCount(appState.herCount);
      appState.totalCount = appState.myCount + appState.herCount;
      appState.fightHistory = normalizeHistory(appState.fightHistory);

      if (currentMode === "shared") {
        if (!coupleRef) {
          return;
        }
        await coupleRef.set(buildFirestorePayload(appState), { merge: true });
        return;
      }

      localStorage.setItem(STORAGE_KEYS.myCount, String(appState.myCount));
      localStorage.setItem(STORAGE_KEYS.herCount, String(appState.herCount));
      localStorage.setItem(STORAGE_KEYS.totalCount, String(appState.totalCount));
      localStorage.setItem(STORAGE_KEYS.fightHistory, JSON.stringify(appState.fightHistory));

      if (appState.lastFightDate) {
        localStorage.setItem(STORAGE_KEYS.lastFightDate, appState.lastFightDate);
      } else {
        localStorage.removeItem(STORAGE_KEYS.lastFightDate);
      }
    }

    function updateUI() {
      const soundEnabled = isSoundEnabled();
      const canEdit = currentMode === "local" || Boolean(currentUser && currentCoupleId && coupleRef);
      const streak = calculateStreak();

      elements.sharedControls.hidden = currentMode !== "shared";
      elements.localModeButton.classList.toggle("active", currentMode === "local");
      elements.sharedModeButton.classList.toggle("active", currentMode === "shared");
      elements.localModeButton.setAttribute("aria-selected", String(currentMode === "local"));
      elements.sharedModeButton.setAttribute("aria-selected", String(currentMode === "shared"));
      elements.modeBadge.textContent = currentMode === "local" ? "Local" : "Shared";
      elements.soundToggle.textContent = soundEnabled ? "🔊 Sound ON" : "🔇 Sound OFF";
      elements.soundToggle.setAttribute("aria-pressed", String(soundEnabled));

      setNumberText(elements.myCount, appState.myCount, "myCount");
      setNumberText(elements.herCount, appState.herCount, "herCount");
      setNumberText(elements.totalCount, appState.totalCount, "totalCount");
      elements.streakCount.textContent = `Peace streak: ${streak} ${streak === 1 ? "day" : "days"} 💖`;
      elements.verdictText.textContent = getVerdict();

      elements.meButton.disabled = isSaving || !canEdit;
      elements.herButton.disabled = isSaving || !canEdit;
      elements.resetButton.disabled = isSaving || (currentMode === "shared" && !canEdit);
      elements.joinButton.disabled = isSaving || currentMode !== "shared";

      updateAuthLabels();
      updateAuthPanel();
      renderHistory();
      maybeCelebrateStreak(streak);
    }

    function calculateStreak() {
      const lastFight = parseDate(appState.lastFightDate);
      if (!lastFight) {
        return 0;
      }

      const today = new Date();
      const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      const fightMidnight = new Date(lastFight.getFullYear(), lastFight.getMonth(), lastFight.getDate()).getTime();
      return Math.max(0, Math.floor((todayMidnight - fightMidnight) / ONE_DAY));
    }

    async function addFight(person) {
      if (isSaving) {
        return;
      }

      if (currentMode === "shared" && (!currentUser || !currentCoupleId || !coupleRef)) {
        showToast("Join a Couple ID first 💕");
        return;
      }

      userHasInteracted = true;
      suppressStreakCelebration = true;
      const button = person === "me" ? elements.meButton : elements.herButton;
      const fight = {
        person,
        timestamp: new Date().toISOString()
      };

      isSaving = true;
      lastNewHistoryTimestamp = fight.timestamp;
      updateUI();

      animateButton(button);
      playSound(person === "me" ? "me" : "her");
      window.setTimeout(playVoiceLine, 360);

      try {
        await animateCoin(button, elements.jarTarget);

        if (currentMode === "shared") {
          await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(coupleRef);
            const current = snapshot.exists ? normalizeFirestoreData(snapshot.data()) : createEmptyState();
            const next = addFightToState(current, fight);
            transaction.set(coupleRef, buildFirestorePayload(next), { merge: true });
          });
        } else {
          appState = addFightToState(appState, fight);
          await saveData();
          updateUI();
        }
      } catch (error) {
        console.error("Could not add fight:", error);
        showToast("That coin bounced. Try once more.");
      } finally {
        isSaving = false;
        suppressStreakCelebration = false;
        updateUI();
      }
    }

    function playSound(type) {
      if (!isSoundEnabled()) {
        return;
      }

      const audioMap = {
        me: elements.coinAudio,
        her: elements.herAudio,
        voice: elements.voiceAudio,
        celebration: elements.celebrationAudio
      };
      const audio = audioMap[type];

      if (!audio) {
        return;
      }

      if (activeAudio && activeAudio !== audio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      }

      audio.pause();
      audio.currentTime = 0;
      activeAudio = audio;

      audio.play().catch(() => {
        // Browsers may block audio until a direct user gesture; the next click will work.
      });

      audio.onended = () => {
        if (activeAudio === audio) {
          activeAudio = null;
        }
      };
    }

    function playVoiceLine() {
      if (!isSoundEnabled()) {
        return;
      }

      const line = VOICE_LINES[Math.floor(Math.random() * VOICE_LINES.length)];
      showToast(line);
      playSound("voice");

      window.setTimeout(() => {
        if (!isSoundEnabled() || !("speechSynthesis" in window)) {
          return;
        }

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(line.replace(/[😏😂😤💸]/gu, ""));
        utterance.rate = 1.04;
        utterance.pitch = 1.28;
        utterance.volume = 0.82;
        window.speechSynthesis.speak(utterance);
      }, 340);
    }

    function playCelebration() {
      if (isSoundEnabled()) {
        playSound("celebration");
      }

      document.body.classList.add("celebrating");
      window.setTimeout(() => document.body.classList.remove("celebrating"), 1350);
      launchConfetti();
    }

    function toggleSound() {
      userHasInteracted = true;
      const enabled = !isSoundEnabled();
      localStorage.setItem(STORAGE_KEYS.soundEnabled, String(enabled));

      if (!enabled && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      if (!enabled && activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
        activeAudio = null;
      }

      showToast(enabled ? "Sound is back 🔊" : "Sound is taking a nap 🔇");
      updateUI();
    }

    function setupAudio() {
      elements.coinAudio.src = createWavDataUri([
        { frequency: 1320, duration: 0.07 },
        { frequency: 1760, duration: 0.11 }
      ]);
      elements.herAudio.src = createWavDataUri([
        { frequency: 784, duration: 0.07 },
        { frequency: 1174, duration: 0.08 },
        { frequency: 1568, duration: 0.1 }
      ]);
      elements.voiceAudio.src = createWavDataUri([
        { frequency: 420, duration: 0.07 },
        { frequency: 630, duration: 0.08 },
        { frequency: 520, duration: 0.07 }
      ]);
      elements.celebrationAudio.src = createWavDataUri([
        { frequency: 659, duration: 0.09 },
        { frequency: 784, duration: 0.09 },
        { frequency: 988, duration: 0.12 },
        { frequency: 1318, duration: 0.16 }
      ]);

      [elements.coinAudio, elements.herAudio, elements.voiceAudio, elements.celebrationAudio].forEach((audio) => {
        audio.load();
      });
    }

    async function setMode(mode) {
      userHasInteracted = true;
      currentMode = mode;
      localStorage.setItem("swearJarMode", currentMode);

      if (mode === "shared") {
        initFirebase();
      }

      await loadData();
      updateUI();
    }

    async function connectToCouple() {
      userHasInteracted = true;
      if (!initFirebase()) {
        showToast("Paste Firebase config before sharing.");
        return;
      }

      const coupleId = sanitizeCoupleId(elements.coupleIdInput.value);
      if (!coupleId) {
        showToast("Use 3-40 letters, numbers, - or _.");
        return;
      }

      if (!currentUser) {
        await loginUser("anonymous");

        await new Promise((resolve) => {
          const unsubscribe = auth.onAuthStateChanged((user) => {
              if (user) {
             unsubscribe();
            resolve();
            }
          });
        });
      }

      if (!currentUser) {
        return;
      }

      currentMode = "shared";
      currentCoupleId = coupleId;
      localStorage.setItem("swearJarMode", currentMode);
      localStorage.setItem("swearJarCoupleId", currentCoupleId);
      elements.coupleIdInput.value = currentCoupleId;
      setAuthStatus(`Joined ${currentCoupleId}`);

      coupleRef = db.collection("couples").doc(currentCoupleId);
      const snapshot = await coupleRef.get();
      if (!snapshot.exists) {
        await coupleRef.set(buildFirestorePayload(createEmptyState()), { merge: true });
      }

      startRealtimeListener();
      showToast("Shared jar connected 💕");
      updateUI();
    }

    async function joinCouple() {
      return connectToCouple();
    }

    async function resetJar() {
      if (isSaving) {
        return;
      }

      userHasInteracted = true;
      animateButton(elements.resetButton);
      isSaving = true;
      appState = createEmptyState();
      lastNewHistoryTimestamp = "";

      try {
        if (currentMode === "local") {
          localStorage.removeItem(STORAGE_KEYS.myCount);
          localStorage.removeItem(STORAGE_KEYS.herCount);
          localStorage.removeItem(STORAGE_KEYS.totalCount);
          localStorage.removeItem(STORAGE_KEYS.fightHistory);
          localStorage.removeItem(STORAGE_KEYS.lastFightDate);
        }

        await saveData();
        showToast("Peace treaty accepted ❤️");
        playSound("celebration");
        launchConfetti();
      } catch (error) {
        console.error("Could not reset jar:", error);
        showToast("The reset needs another try.");
      } finally {
        isSaving = false;
        updateUI();
      }
    }

    function addFightToState(state, fight) {
      const next = {
        myCount: sanitizeCount(state.myCount),
        herCount: sanitizeCount(state.herCount),
        totalCount: sanitizeCount(state.totalCount),
        fightHistory: normalizeHistory(state.fightHistory),
        lastFightDate: fight.timestamp
      };

      if (fight.person === "me") {
        next.myCount += 1;
      } else {
        next.herCount += 1;
      }

      next.totalCount = next.myCount + next.herCount;
      next.fightHistory = [...next.fightHistory, fight];
      return next;
    }

    function normalizeFirestoreData(data) {
      const meCount = sanitizeCount(data && data.meCount);
      const herCount = sanitizeCount(data && data.herCount);
      const totalCount = meCount + herCount;

      return {
        myCount: meCount,
        herCount,
        totalCount,
        fightHistory: normalizeHistory(data && data.fightHistory),
        lastFightDate: toIsoString(data && data.lastFightDate)
      };
    }

    function buildFirestorePayload(state) {
      const lastFight = parseDate(state.lastFightDate);
      return {
        meCount: sanitizeCount(state.myCount),
        herCount: sanitizeCount(state.herCount),
        totalCount: sanitizeCount(state.myCount) + sanitizeCount(state.herCount),
        fightHistory: normalizeHistory(state.fightHistory),
        lastFightDate: lastFight ? firebase.firestore.Timestamp.fromDate(lastFight) : null
      };
    }

    function renderHistory() {
      const history = normalizeHistory(appState.fightHistory)
        .slice()
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      elements.historyCount.textContent = String(history.length);

      if (!history.length) {
        elements.historyList.innerHTML = '<div class="empty-history">No coins yet. Suspiciously peaceful 💖</div>';
        return;
      }

      const fragment = document.createDocumentFragment();
      history.forEach((entry) => {
        const item = document.createElement("div");
        item.className = "history-item";
        if (entry.timestamp === lastNewHistoryTimestamp) {
          item.classList.add("is-new");
        }
        item.textContent = formatHistoryEntry(entry);
        fragment.appendChild(item);
      });

      elements.historyList.replaceChildren(fragment);
    }

    function formatHistoryEntry(entry) {
      const isMe = entry.person === "me";
      const name = isMe ? "Me" : "She";
      const emoji = isMe ? "😅" : "😜";
      return `${emoji} ${name} messed up on ${formatDate(entry.timestamp)}`;
    }

    function formatDate(value) {
      const date = parseDate(value);
      if (!date) {
        return "a mysterious date";
      }

      const day = date.getDate();
      const month = date.toLocaleString("en-US", { month: "short" });
      const time = date.toLocaleString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
      return `${day} ${month}, ${time}`;
    }

    function getVerdict() {
      if (appState.myCount > appState.herCount) {
        return "You are the troublemaker 😤";
      }
      if (appState.herCount > appState.myCount) {
        return "She owes more coins 😏";
      }
      return "Perfect balance ⚖️";
    }

    function updateAuthLabels() {
      if (currentMode === "local") {
        elements.syncStatus.textContent = "Private jar on this device";
        setAuthStatus("Local mode");
        return;
      }

      if (!hasFirebaseConfig()) {
        elements.syncStatus.textContent = "Firebase config needed";
        setAuthStatus("Paste Firebase config to unlock shared mode");
        return;
      }

      if (!window.firebase) {
        elements.syncStatus.textContent = "Firebase CDN unavailable";
        setAuthStatus("CDN unavailable");
        return;
      }

      if (!currentUser) {
        elements.syncStatus.textContent = "Waiting for login";
        setAuthStatus("Not signed in");
        return;
      }

      if (!currentCoupleId) {
        elements.syncStatus.textContent = "Waiting for Couple ID";
        setAuthStatus(getUserLabel(currentUser));
        return;
      }

      elements.syncStatus.textContent = `Live with ${currentCoupleId}`;
      setAuthStatus(`${getUserLabel(currentUser)} · ${currentCoupleId}`);
    }

    function setAuthStatus(message) {
      if (elements.authStatus) {
        elements.authStatus.textContent = message;
      }
    }

    function toggleAuthPanel() {
      isAuthOpen = !isAuthOpen;
      updateAuthPanel();
    }

    function updateAuthPanel() {
      if (!elements.authPanel || !elements.authToggle || !elements.authPanelBody) {
        return;
      }

      elements.authPanel.classList.toggle("is-collapsed", !isAuthOpen);
      elements.authToggle.setAttribute("aria-expanded", String(isAuthOpen));
      elements.authPanelBody.setAttribute("aria-hidden", String(!isAuthOpen));
      elements.authPanelBody.inert = !isAuthOpen;

      if (elements.authToggleSummary) {
        elements.authToggleSummary.textContent = getAuthSummary();
      }
    }

    function getAuthSummary() {
      if (currentMode === "local") {
        return "Local mode";
      }

      if (!hasFirebaseConfig()) {
        return "Shared mode · config needed";
      }

      if (!currentUser) {
        return "Shared mode · sign in";
      }

      if (!currentCoupleId) {
        return "Shared mode · add Couple ID";
      }

      return `Live · ${currentCoupleId}`;
    }

    function getUserLabel(user) {
      if (!user) {
        return "Not signed in";
      }
      if (user.displayName) {
        return user.displayName;
      }
      if (user.email) {
        return user.email;
      }
      return "Guest login";
    }

    function maybeCelebrateStreak(streak) {
      if (
        suppressStreakCelebration ||
        !userHasInteracted ||
        !STREAK_MILESTONES.includes(streak) ||
        !isSoundEnabled()
      ) {
        return;
      }

      const scope = currentMode === "shared" ? currentCoupleId || "shared" : "local";
      const todayKey = new Date().toDateString();
      const celebrationKey = `${scope}:${streak}:${todayKey}`;
      const lastCelebration = localStorage.getItem("swearJarLastCelebration");

      if (lastCelebration === celebrationKey) {
        return;
      }

      localStorage.setItem("swearJarLastCelebration", celebrationKey);
      playCelebration();
      showToast(`${streak} peaceful days. That deserves sparkle 🎉`);
    }

    function initializePreferences() {
      if (localStorage.getItem(STORAGE_KEYS.soundEnabled) === null) {
        localStorage.setItem(STORAGE_KEYS.soundEnabled, "true");
      }
    }

    function launchConfetti() {
      const colors = ["#ff7aa8", "#ffd166", "#b8a4ff", "#70d6c7", "#ffffff"];
      elements.confettiLayer.innerHTML = "";

      for (let i = 0; i < 34; i += 1) {
        const piece = document.createElement("span");
        piece.className = "confetti-piece";
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.setProperty("--drift", `${Math.random() * 220 - 110}px`);
        piece.style.animationDelay = `${Math.random() * 220}ms`;
        piece.style.transform = `rotate(${Math.random() * 180}deg)`;
        elements.confettiLayer.appendChild(piece);
      }

      window.setTimeout(() => {
        elements.confettiLayer.innerHTML = "";
      }, 1900);
    }

    function setNumberText(element, value, key) {
      const nextValue = String(sanitizeCount(value));
      if (element.textContent !== nextValue) {
        element.textContent = nextValue;
      }

      if (previousCounts[key] !== null && previousCounts[key] !== nextValue) {
        element.classList.remove("pop");
        void element.offsetWidth;
        element.classList.add("pop");
      }

      previousCounts[key] = nextValue;
    }

    function animateButton(button) {
      button.classList.remove("bounce");
      void button.offsetWidth;
      button.classList.add("bounce");
    }

    function animateCoin(fromButton, toJar) {
      if (coinAnimationLock || !fromButton || !toJar) {
        return Promise.resolve();
      }

      coinAnimationLock = true;

      return new Promise((resolve) => {
        const buttonRect = fromButton.getBoundingClientRect();
        const jarRect = toJar.getBoundingClientRect();
        const coin = document.createElement("div");
        const startX = buttonRect.left + buttonRect.width / 2;
        const startY = buttonRect.top + buttonRect.height / 2;
        const endX = jarRect.left + jarRect.width / 2;
        const endY = jarRect.top + jarRect.height * 0.72;

        coin.className = "flying-coin";
        coin.style.left = `${startX}px`;
        coin.style.top = `${startY}px`;
        document.body.appendChild(coin);

        requestAnimationFrame(() => {
          coin.style.left = `${endX}px`;
          coin.style.top = `${endY}px`;
          coin.style.opacity = "0.24";
          coin.style.transform = "translate(-50%, -50%) scale(1.34) rotate(260deg)";
        });

        window.setTimeout(() => {
          toJar.classList.add("coin-landed");
          coin.remove();
          coinAnimationLock = false;
          resolve();
        }, 680);

        window.setTimeout(() => {
          toJar.classList.remove("coin-landed");
        }, 1180);
      });
    }

    function showToast(message) {
      window.clearTimeout(toastTimer);
      elements.toast.textContent = message;
      elements.toast.classList.add("show");
      toastTimer = window.setTimeout(() => {
        elements.toast.classList.remove("show");
      }, 2400);
    }

    function isSoundEnabled() {
      return localStorage.getItem(STORAGE_KEYS.soundEnabled) !== "false";
    }

    function hasFirebaseConfig() {
      return Boolean(
        FIREBASE_CONFIG.apiKey &&
        FIREBASE_CONFIG.authDomain &&
        FIREBASE_CONFIG.projectId &&
        !String(FIREBASE_CONFIG.apiKey).includes("YOUR_")
      );
    }

    function sanitizeCoupleId(value) {
      const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
      if (!/^[a-z0-9_-]{3,40}$/.test(normalized)) {
        return "";
      }
      return normalized;
    }

    function readStoredNumber(key) {
      return sanitizeCount(localStorage.getItem(key));
    }

    function readStoredHistory() {
      try {
        return normalizeHistory(JSON.parse(localStorage.getItem(STORAGE_KEYS.fightHistory) || "[]"));
      } catch (error) {
        return [];
      }
    }

    function normalizeHistory(history) {
      if (!Array.isArray(history)) {
        return [];
      }

      return history
        .filter((entry) => entry && (entry.person === "me" || entry.person === "her") && parseDate(entry.timestamp))
        .map((entry) => ({
          person: entry.person,
          timestamp: parseDate(entry.timestamp).toISOString()
        }));
    }

    function sanitizeCount(value) {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) {
        return 0;
      }
      return Math.floor(number);
    }

    function parseDate(value) {
      if (!value) {
        return null;
      }

      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
      }

      if (value && typeof value.toDate === "function") {
        const date = value.toDate();
        return Number.isNaN(date.getTime()) ? null : date;
      }

      if (value && typeof value.seconds === "number") {
        const date = new Date(value.seconds * 1000);
        return Number.isNaN(date.getTime()) ? null : date;
      }

      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function toIsoString(value) {
      const date = parseDate(value);
      return date ? date.toISOString() : null;
    }

    function createWavDataUri(notes) {
      const sampleRate = 44100;
      const samples = [];

      notes.forEach((note) => {
        const length = Math.floor(sampleRate * note.duration);
        for (let i = 0; i < length; i += 1) {
          const progress = i / length;
          const attack = Math.min(1, progress / 0.08);
          const release = Math.min(1, (1 - progress) / 0.24);
          const envelope = Math.max(0, Math.min(attack, release));
          const wave = Math.sin(2 * Math.PI * note.frequency * (i / sampleRate));
          samples.push(wave * envelope * 0.42);
        }
      });

      const dataLength = samples.length * 2;
      const buffer = new ArrayBuffer(44 + dataLength);
      const view = new DataView(buffer);

      writeAscii(view, 0, "RIFF");
      view.setUint32(4, 36 + dataLength, true);
      writeAscii(view, 8, "WAVE");
      writeAscii(view, 12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeAscii(view, 36, "data");
      view.setUint32(40, dataLength, true);

      let offset = 44;
      samples.forEach((sample) => {
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped * 0x7fff, true);
        offset += 2;
      });

      let binary = "";
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }

      return `data:audio/wav;base64,${btoa(binary)}`;
    }

    function writeAscii(view, offset, text) {
      for (let i = 0; i < text.length; i += 1) {
        view.setUint8(offset + i, text.charCodeAt(i));
      }
    }
