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

    // 1. Generate 1-20 Grid
    grid.innerHTML = "";
    for (let i = 1; i <= 20; i++) {
        const btn = document.createElement("button");
        btn.textContent = i;
        btn.className = "lotto-num-btn"; 
        
        btn.onclick = () => {
            if (selectedNumbers.includes(i)) {
                selectedNumbers = selectedNumbers.filter(n => n !== i);
                btn.classList.remove("selected");
            } else if (selectedNumbers.length < 4) {
                selectedNumbers.push(i);
                btn.classList.add("selected");
            }
            
            selectionDisplay.textContent = selectedNumbers.sort((a,b) => a-b).join(" - ") || "None Selected";
            buyBtn.disabled = selectedNumbers.length !== 4;
        };
        grid.appendChild(btn);
    }

    // 2. Listen to Lottery Status (Pool, Winners, Results, and TIMER)
    onSnapshot(doc(db, "lottery", "status"), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            const currentPool = data.currentPool || 0;
            
            // A. Jackpot Display
            const poolEl = document.getElementById("lottery-jackpot-display");
            if (poolEl) {
                poolEl.textContent = `$${currentPool.toLocaleString()}`;
                poolEl.style.color = currentPool >= MAX_JACKPOT ? "#e74c3c" : "#2ecc71";
                if (currentPool >= MAX_JACKPOT) poolEl.textContent += " (MAX)";
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
                        countdownEl.textContent = "DRAWING SOON...";
                        countdownEl.style.color = "#e74c3c";
                        // Prevent last-second buys
                        buyBtn.disabled = true;
                        buyBtn.textContent = "DRAW IN PROGRESS";
                        clearInterval(countdownInterval);
                        return;
                    }

                    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
                    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                    const s = Math.floor((diff % (1000 * 60)) / 1000);

                    countdownEl.textContent = `${d}d ${h}h ${m}m ${s}s`;
                    countdownEl.style.color = "#eee";
                    buyBtn.textContent = `PURCHASE TICKET ($${TICKET_PRICE.toLocaleString()})`;
                };

                updateTimer();
                countdownInterval = setInterval(updateTimer, 1000);
            } else if (timerContainer) {
                timerContainer.classList.add("hidden");
                if (countdownInterval) clearInterval(countdownInterval);
            }

            // C. Results Display
            const winNums = data.lastWinningNumbers || [0, 0, 0, 0];
            winNums.forEach((num, index) => {
                const ball = document.getElementById(`ball-${index}`);
                if (ball) ball.textContent = num === 0 ? "-" : num;
            });

            const msgEl = document.getElementById("lotto-winner-msg");
            if (msgEl) {
                if (data.lastWinnerCount > 0) {
                    const names = data.lastWinners ? data.lastWinners.join(", ") : "Someone";
                    msgEl.innerHTML = `🎉 Winner(s): <span style="color: #f1c40f; font-weight: 900;">${names}</span> split the pot!`;
                    msgEl.style.color = "#2ecc71";
                } else if (winNums[0] !== 0) {
                    msgEl.textContent = "💀 No winners. Jackpot Rolled Over!";
                    msgEl.style.color = "#e74c3c";
                }
            }
        }
    });

    // 3. THE QUOTA & TICKETS LISTENER
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
                quotaDisplay.textContent = `${currentCount} / ${maxAllowed}`;
                quotaDisplay.style.color = currentCount >= maxAllowed ? "#e74c3c" : "#3498db";
            }

            if (ticketsList) {
                if (snapshot.empty) {
                    ticketsList.innerHTML = `<p style="color: gray; font-size: 0.7rem; font-style: italic; text-align: center;">No tickets bought for this draw yet.</p>`;
                } else {
                    ticketsList.innerHTML = "";
                    let index = 1;
                    snapshot.forEach(tDoc => {
                        const ticket = tDoc.data();
                        const div = document.createElement("div");
                        div.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: rgba(52, 152, 219, 0.1); padding: 8px; border-radius: 6px; border-left: 3px solid #3498db; margin-bottom: 4px;";
                        div.innerHTML = `
                            <span style="font-family: monospace; font-weight: bold; color: #eee; font-size: 0.85rem;">
                                ${ticket.numbers.join(' - ')}
                            </span>
                            <span style="font-size: 0.5rem; color: #3498db; font-weight: 800; text-transform: uppercase;">
                                Entry #${index++}
                            </span>
                        `;
                        ticketsList.appendChild(div);
                    });
                }
            }
        });
    }

    // 4. Purchase Logic with DUPLICATE PROTECTION
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
            if (JSON.stringify(tDoc.data().numbers) === selectionStr) {
                isDuplicate = true;
            }
        });

        if (isDuplicate) {
            return alert(`⚠️ Duplicate Entry! You already have a ticket with: ${currentSelection.join(' - ')}`);
        }

        if (userData.balance < TICKET_PRICE) return alert("Insufficient funds.");

        try {
            buyBtn.disabled = true;
            
            const poolRef = doc(db, "lottery", "status");
            const poolSnap = await getDoc(poolRef);
            const currentPool = poolSnap.data().currentPool || 0;

            let poolIncrement = TICKET_PRICE * 0.70; 
            if (currentPool >= MAX_JACKPOT) {
                poolIncrement = 0; 
            } else if (currentPool + poolIncrement > MAX_JACKPOT) {
                poolIncrement = MAX_JACKPOT - currentPool; 
            }

            await updateDoc(userRef, { balance: increment(-TICKET_PRICE) });
            
            await addDoc(collection(db, "lottery_tickets"), {
                playerUID: user.uid,
                numbers: currentSelection,
                timestamp: new Date().toISOString()
            });

            await updateDoc(poolRef, {
                currentPool: increment(poolIncrement)
            });

            await logHistory(user.uid, `🎟️ Bought Lottery Ticket: ${currentSelection.join(', ')}`, "purchase");
            
            selectedNumbers = [];
            selectionDisplay.textContent = "None Selected";
            document.querySelectorAll(".lotto-num-btn").forEach(b => b.classList.remove("selected"));
            buyBtn.disabled = true;
            
        } catch (err) { 
            console.error("Purchase failed:", err);
            buyBtn.disabled = false;
        }
    };
}