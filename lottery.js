// ---------- lottery.js (SYSTEM UI INTEGRATED) ----------
import { db, auth } from "./firebaseConfig.js";
import { 
    doc, getDoc, updateDoc, collection, addDoc, query, where, getDocs, increment, onSnapshot 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";

let selectedNumbers = [];
let countdownInterval = null;
const TICKET_PRICE = 2500;
const MAX_JACKPOT = 150000;

export function initLotteryUI() {
    const grid = document.getElementById("lottery-number-grid");
    const selectionDisplay = document.getElementById("selected-numbers-display");
    const buyBtn = document.getElementById("buy-lotto-btn");
    const ticketsList = document.getElementById("active-tickets-list");
    const quotaDisplay = document.getElementById("lotto-quota-display");

    if (!grid) return;

    // 1. Generate 1-20 Grid (Styled for Sidebar Dashboard)
    grid.innerHTML = "";
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(5, 1fr)";
    grid.style.gap = "8px";
    grid.style.margin = "15px 0";

    for (let i = 1; i <= 20; i++) {
        const btn = document.createElement("button");
        btn.textContent = i;
        btn.className = "lotto-num-btn";
        
        // Inline styling to ensure visual consistency with the new theme
        btn.style.cssText = `
            padding: 12px 5px;
            background: rgba(255,255,255,0.05);
            color: white;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            transition: 0.2s;
            font-size: 0.9rem;
        `;
        
        btn.onclick = () => {
            if (selectedNumbers.includes(i)) {
                selectedNumbers = selectedNumbers.filter(n => n !== i);
                btn.style.background = "rgba(255,255,255,0.05)";
                btn.style.color = "white";
                btn.style.borderColor = "rgba(255,255,255,0.1)";
            } else if (selectedNumbers.length < 4) {
                selectedNumbers.push(i);
                btn.style.background = "#f1c40f";
                btn.style.color = "#111";
                btn.style.borderColor = "#f1c40f";
            }
            
            selectionDisplay.textContent = selectedNumbers.sort((a,b) => a-b).join(" - ") || "None Selected";
            buyBtn.disabled = selectedNumbers.length !== 4;
            
            // Highlight button text color for selection
            if (selectedNumbers.length === 4) {
                buyBtn.style.opacity = "1";
            } else {
                buyBtn.style.opacity = "0.5";
            }
        };
        grid.appendChild(btn);
    }

    // 2. Listen to Lottery Status
    onSnapshot(doc(db, "lottery", "status"), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            const currentPool = data.currentPool || 0;
            
            // A. Jackpot Display
            const poolEl = document.getElementById("lottery-jackpot-display");
            if (poolEl) {
                poolEl.textContent = `$${currentPool.toLocaleString()}`;
                poolEl.style.color = currentPool >= MAX_JACKPOT ? "#e74c3c" : "#2ecc71";
            }

            // B. Countdown Timer Logic
            const timerContainer = document.getElementById("lotto-timer-container");
            const countdownEl = document.getElementById("lotto-countdown");

            if (data.nextDrawTime && timerContainer && countdownEl) {
                if (countdownInterval) clearInterval(countdownInterval);
                timerContainer.classList.remove("hidden");

                const updateTimer = () => {
                    const now = new Date().getTime();
                    const target = new Date(data.nextDrawTime).getTime();
                    const diff = target - now;

                    if (diff <= 0) {
                        countdownEl.textContent = "DRAWING...";
                        countdownEl.style.color = "#e74c3c";
                        buyBtn.disabled = true;
                        buyBtn.textContent = "DRAW IN PROGRESS";
                        clearInterval(countdownInterval);
                        return;
                    }

                    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                    const s = Math.floor((diff % (1000 * 60)) / 1000);

                    countdownEl.textContent = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                    buyBtn.textContent = `PURCHASE TICKET ($${TICKET_PRICE.toLocaleString()})`;
                };

                updateTimer();
                countdownInterval = setInterval(updateTimer, 1000);
            }

            // C. Results Display
            const winNums = data.lastWinningNumbers || [0, 0, 0, 0];
            winNums.forEach((num, index) => {
                const ball = document.getElementById(`ball-${index}`);
                if (ball) {
                    ball.textContent = num === 0 ? "-" : num;
                    ball.style.background = num === 0 ? "rgba(0,0,0,0.2)" : "#f1c40f";
                    ball.style.color = num === 0 ? "#555" : "#111";
                }
            });
        }
    });

    // 3. THE QUOTA & TICKETS LISTENER (Optimized for Mobile/Sidebar)
    if (auth.currentUser) {
        const userTicketsQ = query(
            collection(db, "lottery_tickets"), 
            where("playerUID", "==", auth.currentUser.uid)
        );

        onSnapshot(userTicketsQ, async (snapshot) => {
            const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
            if (!userSnap.exists()) return;
            
            const userData = userSnap.data();
            const tier = userData.membershipLevel || 'standard';
            const limits = { standard: 1, basic: 3, premium: 5, platinum: 7 };
            const maxAllowed = limits[tier];
            const currentCount = snapshot.size;

            if (quotaDisplay) {
                quotaDisplay.textContent = `${currentCount} / ${maxAllowed} Used`;
                quotaDisplay.style.color = currentCount >= maxAllowed ? "#e74c3c" : "#3498db";
            }

            if (ticketsList) {
                if (snapshot.empty) {
                    ticketsList.innerHTML = `<p style="color: gray; font-size: 0.75rem; font-style: italic; text-align: center; padding: 10px;">No active entries.</p>`;
                } else {
                    ticketsList.innerHTML = "";
                    snapshot.forEach(tDoc => {
                        const ticket = tDoc.data();
                        const div = document.createElement("div");
                        div.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 6px;";
                        div.innerHTML = `
                            <span style="font-family: monospace; font-weight: 800; color: #f1c40f; letter-spacing: 1px;">
                                ${ticket.numbers.join(' . ')}
                            </span>
                            <span style="font-size: 0.6rem; color: #888; text-transform: uppercase; font-weight: bold;">ACTIVE</span>
                        `;
                        ticketsList.appendChild(div);
                    });
                }
            }
        });
    }

    // 4. Purchase Logic
    buyBtn.onclick = async () => {
        const user = auth.currentUser;
        if (!user) return;

        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.data();

        const limits = { standard: 1, basic: 3, premium: 5, platinum: 7 };
        const maxAllowed = limits[userData.membershipLevel || 'standard'];

        const existingTicketsQ = query(collection(db, "lottery_tickets"), where("playerUID", "==", user.uid));
        const existingSnap = await getDocs(existingTicketsQ);
        
        if (existingSnap.size >= maxAllowed) {
            return alert(`🚫 Limit reached! Your tier max is ${maxAllowed} tickets.`);
        }

        const currentSelection = [...selectedNumbers].sort((a, b) => a - b);
        const selectionStr = JSON.stringify(currentSelection);
        let isDuplicate = false;

        existingSnap.forEach(tDoc => {
            if (JSON.stringify(tDoc.data().numbers) === selectionStr) isDuplicate = true;
        });

        if (isDuplicate) return alert(`⚠️ Duplicate Entry! You already have this combination.`);
        if (userData.balance < TICKET_PRICE) return alert("Insufficient funds.");

        try {
            buyBtn.disabled = true;
            buyBtn.textContent = "Processing...";
            
            const poolRef = doc(db, "lottery", "status");
            const poolSnap = await getDoc(poolRef);
            const currentPool = poolSnap.data().currentPool || 0;

            let poolIncrement = TICKET_PRICE * 0.70; 
            if (currentPool >= MAX_JACKPOT) poolIncrement = 0; 
            else if (currentPool + poolIncrement > MAX_JACKPOT) poolIncrement = MAX_JACKPOT - currentPool; 

            await updateDoc(userRef, { balance: increment(-TICKET_PRICE) });
            await addDoc(collection(db, "lottery_tickets"), {
                playerUID: user.uid,
                numbers: currentSelection,
                timestamp: new Date().toISOString()
            });
            await updateDoc(poolRef, { currentPool: increment(poolIncrement) });

            await logHistory(user.uid, `🎟️ Lottery Entry: ${currentSelection.join(', ')}`, "purchase");
            
            selectedNumbers = [];
            selectionDisplay.textContent = "None Selected";
            document.querySelectorAll(".lotto-num-btn").forEach(b => {
                b.style.background = "rgba(255,255,255,0.05)";
                b.style.color = "white";
            });
            buyBtn.disabled = true;
            buyBtn.textContent = `PURCHASE TICKET ($${TICKET_PRICE.toLocaleString()})`;
            
        } catch (err) { 
            console.error("Purchase failed:", err);
            buyBtn.disabled = false;
        }
    };
}