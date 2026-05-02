import { db, auth } from "../firebaseConfig.js";
import { doc, getDoc, getDocs, updateDoc, onSnapshot, collection, writeBatch, increment, query, where } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "../historyManager.js";
import { sendSlackMessage } from "../slackNotifier.js";
import { getDOMElements } from "./adminUtils.js";

let lotteryPoolListener = null;
let activeTicketsListener = null;
let activeAdminListener = null;

export function listenForAdminLottery() {
  const el = getDOMElements();
  if (!el.adminLotteryPoolDisplay) return;
  if (lotteryPoolListener) lotteryPoolListener();

  lotteryPoolListener = onSnapshot(doc(db, "lottery", "status"), (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      const pool = data.currentPool || 0;
      const totalBurned = data.totalEconomyBurned || 0;

      el.adminLotteryPoolDisplay.textContent = `$${pool.toLocaleString()}`;
      if (el.adminLotteryBurnDisplay) {
        el.adminLotteryBurnDisplay.textContent = `$${totalBurned.toLocaleString()}`;
      }
    }
  });

  // Setup draw timer
  if (el.setLottoTimeBtn) {
    el.setLottoTimeBtn.onclick = setLotteryDrawTime;
  }

  // Setup draw trigger
  if (el.triggerLottoBtn) {
    el.triggerLottoBtn.onclick = triggerLotteryDraw;
  }
}

export function listenToGlobalTickets() {
  const el = getDOMElements();
  if (!el.adminLiveTicketsList) return;
  if (activeTicketsListener) activeTicketsListener();

  activeTicketsListener = onSnapshot(collection(db, "lottery_tickets"), async (snapshot) => {
    if (snapshot.empty) {
      el.adminLiveTicketsList.innerHTML = `<p style="color: gray; font-size: 0.75rem; font-style: italic; text-align: center;">No tickets in the system...</p>`;
      return;
    }
    el.adminLiveTicketsList.innerHTML = "";

    const ticketPromises = snapshot.docs.map(async (tDoc) => {
      const ticket = tDoc.data();
      const userSnap = await getDoc(doc(db, "users", ticket.playerUID));
      const username = userSnap.exists() ? userSnap.data().username : "Unknown";
      return { username, numbers: ticket.numbers.join(" - ") };
    });

    const tickets = await Promise.all(ticketPromises);
    tickets.forEach(t => {
      const div = document.createElement("div");
      div.style.cssText = "display: flex; justify-content: space-between; padding: 6px 10px; background: rgba(255,255,255,0.03); border-radius: 4px; border-left: 3px solid #f1c40f; font-size: 0.8rem;";
      div.innerHTML = `<span><strong>${t.username}</strong></span><span style="font-family: monospace; color: #f1c40f;">${t.numbers}</span>`;
      el.adminLiveTicketsList.appendChild(div);
    });
  });
}

async function setLotteryDrawTime() {
  const el = getDOMElements();
  const selectedTime = el.adminLottoDate.value;
  if (!selectedTime) return alert("Please select a date and time.");
  
  try {
    const poolRef = doc(db, "lottery", "status");
    await updateDoc(poolRef, { nextDrawTime: new Date(selectedTime).toISOString() });
    alert("⏰ Draw timer updated!");
    sendSlackMessage(`📅 *Lottery Scheduled:* The next draw has been set for *${new Date(selectedTime).toLocaleString()}*! Get your tickets now.`);
  } catch (err) {
    console.error(err);
    alert("Failed to set timer.");
  }
}

async function triggerLotteryDraw() {
  const el = getDOMElements();
  let winningNumbers = [];

  // Check for manual override
  if (el.adminLottoOverride && el.adminLottoOverride.value.trim() !== "") {
    const parts = el.adminLottoOverride.value.split(',').map(n => parseInt(n.trim()));
    const valid = parts.length === 4 && parts.every(n => n >= 1 && n <= 20) && new Set(parts).size === 4;

    if (!valid) return alert("❌ Invalid Override! Enter 4 unique numbers between 1 and 20 (e.g. 1, 5, 10, 15).");
    winningNumbers = parts.sort((a, b) => a - b);
  } else {
    // Generate random winners
    while (winningNumbers.length < 4) {
      let num = Math.floor(Math.random() * 20) + 1;
      if (!winningNumbers.includes(num)) winningNumbers.push(num);
    }
    winningNumbers.sort((a, b) => a - b);
  }

  if (!confirm(`Trigger Draw with numbers: ${winningNumbers.join(', ')}? This clears all tickets!`)) return;

  try {
    const poolRef = doc(db, "lottery", "status");
    const poolSnap = await getDoc(poolRef);
    const currentPool = poolSnap.data().currentPool || 0;

    const ticketsSnap = await getDocs(collection(db, "lottery_tickets"));
    let winnerUIDs = [];

    // Identify Winners
    ticketsSnap.forEach(tDoc => {
      const ticket = tDoc.data();
      if (JSON.stringify(ticket.numbers) === JSON.stringify(winningNumbers)) {
        winnerUIDs.push(ticket.playerUID);
      }
    });

    // Process Results
    if (winnerUIDs.length > 0) {
      const rawShare = Math.floor(currentPool / winnerUIDs.length);
      const taxAmount = Math.floor(rawShare * 0.10);
      const finalPayout = rawShare - taxAmount;
      let winnerNames = [];

      for (const uid of winnerUIDs) {
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);
        const name = userSnap.exists() ? userSnap.data().username : "Unknown";
        winnerNames.push(name);

        await updateDoc(userRef, { balance: increment(finalPayout) });
        await logHistory(uid, `🎊 LOTTERY WIN! Won $${finalPayout.toLocaleString()} (After 10% Tax)`, "transfer-in");
      }

      const totalTaxBurned = taxAmount * winnerUIDs.length;
      const namesString = winnerNames.join(", ");

      await updateDoc(poolRef, {
        currentPool: 10000,
        lastWinningNumbers: winningNumbers,
        lastWinnerCount: winnerUIDs.length,
        lastWinners: winnerNames,
        totalEconomyBurned: increment(totalTaxBurned),
        lastDrawDate: new Date().toISOString(),
        nextDrawTime: null
      });

      sendSlackMessage(
        `🎊 *LOTTERY JACKPOT HIT!*\n` +
        `🏆 *Winners:* ${namesString}\n` +
        `💰 *Prize:* $${rawShare.toLocaleString()} each\n` +
        `🔢 *Numbers:* ${winningNumbers.join(', ')}\n` +
        `🏛️ *10% Winner Tax Burned:* $${totalTaxBurned.toLocaleString()}`
      );
      alert(`🎊 Draw complete! Winners: ${namesString}`);
    } else {
      await updateDoc(poolRef, {
        lastWinningNumbers: winningNumbers,
        lastWinnerCount: 0,
        lastWinners: [],
        lastDrawDate: new Date().toISOString(),
        nextDrawTime: null
      });

      sendSlackMessage(`💀 *Lottery Result:* No winners. Jackpot rolls over to *$${currentPool.toLocaleString()}*.\n🔢 *Numbers:* ${winningNumbers.join(', ')}`);
      alert(`💀 No winners. Pot rolls over.`);
    }

    // Clear all tickets for next round
    const batch = writeBatch(db);
    ticketsSnap.forEach(tDoc => batch.delete(tDoc.ref));
    await batch.commit();

    if (el.adminLottoOverride) el.adminLottoOverride.value = "";
  } catch (err) {
    console.error("Lottery Draw Error:", err);
    alert("Failed to complete draw.");
  }
}

export function listenForAdminRoster() {
  const el = getDOMElements();
  if (!el.adminRosterContainer) return;
  if (activeAdminListener) activeAdminListener();

  const q = query(collection(db, "contracts"), where("status", "==", "active"));

  activeAdminListener = onSnapshot(q, (snap) => {
    el.adminRosterContainer.innerHTML = "";
    if (snap.empty) {
      el.adminRosterContainer.innerHTML = `<p style="color: gray; text-align: center;">No active players.</p>`;
      return;
    }

    snap.forEach((contractDoc) => {
      const data = contractDoc.data();
      const docId = contractDoc.id;
      const terms = data.terms || {};

      const targetG = (terms.guaranteedPay || 0) / 6;
      const targetB = (terms.nonGuaranteedPay || 0) / 6;

      const div = document.createElement("div");
      div.className = "contract-card admin-roster-card";
      div.style.cssText = "padding: 20px; border-radius: 12px; margin-bottom: 20px; background: var(--card-bg, #1a1a1a); border: 1px solid var(--border-color, #333); color: var(--text-color, #fff);";

      div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
          <strong style="color: #3498db; font-size: 1.3rem;">${data.playerName || 'Player'}</strong>
          <span style="background: rgba(52, 152, 219, 0.2); color: #3498db; padding: 4px 8px; border-radius: 6px; font-size: 0.65rem; font-weight: 800;">${terms.seasons?.toFixed(2)} SEASONS LEFT</span>
        </div>
        <div style="font-size: 0.75rem; color: #888; margin-bottom: 5px;">Team: ${data.team} | Total Season: $${((terms.guaranteedPay || 0) + (terms.nonGuaranteedPay || 0)).toLocaleString()}</div>
        
        <div style="font-size: 0.65rem; color: #888; margin-bottom: 15px; background: rgba(255,255,255,0.02); padding: 5px; border-radius: 4px; border: 1px solid #222; display: flex; justify-content: space-around;">
          <span>Installment Targets:</span>
          <span><b>$${targetG.toLocaleString()}</b> (G)</span>
          <span><b>$${targetB.toLocaleString()}</b> (B)</span>
        </div>

        <div id="admin-alert-area-${data.playerUID}"></div>
        
        <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #333;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
            <div>
              <label style="font-size: 0.6rem; color: #2ecc71; display: block; margin-bottom: 4px; font-weight: 900;">PAY GUARANTEED ($)</label>
              <input type="number" id="pay-g-${docId}" placeholder="0" style="width: 100%; background: #111; border: 1px solid #444; color: white; padding: 8px; border-radius: 6px;">
            </div>
            <div>
              <label style="font-size: 0.6rem; color: #f1c40f; display: block; margin-bottom: 4px; font-weight: 900;">PAY BONUS ($)</label>
              <input type="number" id="pay-b-${docId}" placeholder="0" style="width: 100%; background: #111; border: 1px solid #444; color: white; padding: 8px; border-radius: 6px;">
            </div>
          </div>
          <button onclick="window.adminActionContract('${docId}', 'payInstallment')" style="width: 100%; background: #2ecc71; color: white; border: none; padding: 10px; border-radius: 8px; font-weight: bold; cursor: pointer;">PROCESS SPLIT PAYMENT</button>
        </div>
        
        <div style="display: flex; gap: 8px;">
          <button onclick="window.adminActionContract('${docId}', 'cut')" style="flex:1; background:#e74c3c; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; font-size:0.7rem; cursor:pointer;">CUT</button>
          <button onclick="window.tradePlayer('${docId}')" style="flex:1; background:#f39c12; color:white; border:none; border-radius:6px; padding:10px; font-weight:bold; font-size:0.7rem; cursor:pointer;">TRADE</button>
          <button onclick="window.offerExtension('${docId}')" style="flex:1; background:#444; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; font-size:0.7rem; cursor:pointer;">EXTEND</button>
        </div>
      `;
      el.adminRosterContainer.appendChild(div);

      // Check for pending actions
      getDoc(doc(db, "users", data.playerUID)).then(uSnap => {
        if (!uSnap.exists()) return;
        const uData = uSnap.data();
        const alertContainer = document.getElementById(`admin-alert-area-${data.playerUID}`);
        if (alertContainer && (uData.tradePending || uData.releasePending)) {
          const isTrade = uData.tradePending;
          alertContainer.innerHTML = `
            <div style="border: 2px solid #e74c3c; background: rgba(231, 76, 60, 0.05); padding: 12px; border-radius: 8px; margin: 15px 0;">
              <div style="color: #e74c3c; font-weight: 900; font-size: 0.75rem; margin-bottom: 10px; text-transform: uppercase;">
                🚨 PLAYER REQUEST: ${isTrade ? 'TRADE' : 'RELEASE'}
              </div>
              <div style="display: flex; gap: 8px;">
                ${isTrade ? `<button onclick="window.handleAdminDecision('${docId}', '${data.playerUID}', 'looking')" style="flex:1; background: #f39c12; color:white; border:none; border-radius:6px; padding:10px; font-weight:bold; font-size:0.7rem; cursor:pointer;">LOOKING</button>` : ''}
                <button onclick="window.handleAdminDecision('${docId}', '${data.playerUID}', 'approve')" style="flex:1; background: #2ecc71; color:white; border:none; border-radius:6px; padding:10px; font-weight:bold; font-size:0.7rem; cursor:pointer;">APPROVE</button>
                <button onclick="window.handleAdminDecision('${docId}', '${data.playerUID}', 'reject')" style="flex:1; background: #e74c3c; color:white; border:none; border-radius:6px; padding:10px; font-weight:bold; font-size:0.7rem; cursor:pointer;">REJECT</button>
              </div>
            </div>
          `;
        }
      });
    });
  });
}