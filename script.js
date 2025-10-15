console.log("script.js loaded");

// ---------- Firebase Imports ----------
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { 
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, getDoc, getDocs, collection, addDoc,
<<<<<<< HEAD
  onSnapshot, increment, arrayUnion, query, where, runTransaction, orderBy
=======
  onSnapshot, increment, arrayUnion, query, where
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ---------- Firebase Config ----------
const firebaseConfig = {
  apiKey: "AIzaSyBCEhZWsXu7Bwhfhv110kF1yCG_dfaMWQA",
  authDomain: "blutzs-economy.firebaseapp.com",
  projectId: "blutzs-economy",
  storageBucket: "blutzs-economy.firebasestorage.app",
  messagingSenderId: "179946460985",
  appId: "1:179946460985:web:9df04b226f78b02e2efae8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

<<<<<<< HEAD
// ---------- Admin Username (kept but users should rely on isAdmin in DB) ----------
=======
// ---------- Admin Username ----------
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
const ADMIN_USERNAME = "tennismaster29";

// ---------- Helpers ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// Updated balance display with flash effect
function updateBalanceDisplay(balance, elemId="user-balance", changeType=null) {
  const el = document.getElementById(elemId);
<<<<<<< HEAD
  el.textContent = `$${Number(balance || 0).toFixed(2)}`;
=======
  el.textContent = `$${Number(balance).toFixed(2)}`;
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
  el.className = balance > 50 ? "balance-good" : (balance >= 20 ? "balance-warning" : "balance-bad");

  el.classList.remove("balance-flash-gain", "balance-flash-loss", "balance-flash-admin", "balance-flash-transfer");
  switch(changeType){
    case "gain": el.classList.add("balance-flash-gain"); break;
    case "loss": el.classList.add("balance-flash-loss"); break;
    case "admin": el.classList.add("balance-flash-admin"); break;
    case "transfer": el.classList.add("balance-flash-transfer"); break;
  }
<<<<<<< HEAD
  if(changeType) setTimeout(() => {
    el.classList.remove("balance-flash-gain","balance-flash-loss","balance-flash-admin","balance-flash-transfer");
  }, 1000);
=======
  if(changeType) setTimeout(() => el.classList.remove(el.classList[1]), 1000);
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
}

// ---------- LOGIN / REGISTER ----------
document.getElementById("login-btn").addEventListener("click", async () => {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value.trim();
  if (!username || !password) return alert("Enter both fields");

  const email = username + "@demo.com";

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
<<<<<<< HEAD
    if (error.code === "auth/user-not-found" || error.code === "auth/wrong-password") {
      // create account if not found
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await createOrUpdateUserDoc(cred.user.uid, username);
      } catch (err) {
        alert("Register failed: " + err.message);
      }
=======
    if (error.code === "auth/user-not-found") {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await createOrUpdateUserDoc(cred.user.uid, username);
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
    } else {
      alert("Login failed: " + error.message);
    }
  }
});

// ---------- CREATE OR FIX USER DOC ----------
async function createOrUpdateUserDoc(uid, username) {
  const now = new Date();
  const expiration = new Date(now);
  expiration.setFullYear(now.getFullYear() + 1);

  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);

<<<<<<< HEAD
  const usernameLower = username.toLowerCase();
  const isAdmin = usernameLower === ADMIN_USERNAME.toLowerCase();

  if (!snap.exists()) {
    await setDoc(userRef, {
      username,
      usernameLower,
=======
  if (!snap.exists()) {
    await setDoc(userRef, {
      username,
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
      balance: 0,
      history: [],
      renewalDate: now.toISOString(),
      expirationDate: expiration.toISOString(),
      renewalPending: false,
<<<<<<< HEAD
      isAdmin
      // inventory will be created as an array when user buys items
=======
      isAdmin: username.toLowerCase() === ADMIN_USERNAME.toLowerCase()
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
    });
  } else {
    const data = snap.data();
    const updateData = {};
    if (!data.username) updateData.username = username;
<<<<<<< HEAD
    if (!data.usernameLower) updateData.usernameLower = usernameLower;
=======
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
    if (data.balance === undefined) updateData.balance = 0;
    if (!data.history) updateData.history = [];
    if (!data.renewalDate) updateData.renewalDate = now.toISOString();
    if (!data.expirationDate) updateData.expirationDate = expiration.toISOString();
    if (data.renewalPending === undefined) updateData.renewalPending = false;
<<<<<<< HEAD
    if (data.isAdmin === undefined) updateData.isAdmin = isAdmin;
=======
    if (data.isAdmin === undefined) updateData.isAdmin = username.toLowerCase() === ADMIN_USERNAME.toLowerCase();
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
    if (Object.keys(updateData).length > 0) await updateDoc(userRef, updateData);
  }
}

// ---------- AUTH STATE ----------
<<<<<<< HEAD
let currentUser = null;
onAuthStateChanged(auth, async user => {
  if (!user) {
    console.log("Logged out");
    currentUser = null;
=======
onAuthStateChanged(auth, async user => {
  if (!user) {
    console.log("Logged out");
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
    showScreen("login-screen");
    document.getElementById("login-username").value = "";
    document.getElementById("login-password").value = "";
    document.getElementById("admin-panel").classList.add("hidden");
    document.getElementById("dashboard-navbar").classList.add("hidden");
    return;
  }

  console.log("Logged in:", user.uid);
<<<<<<< HEAD
  currentUser = user;
=======
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
  showScreen("dashboard");
  document.getElementById("dashboard-navbar").classList.remove("hidden");

  const username = user.email.split("@")[0];
  await createOrUpdateUserDoc(user.uid, username);

  const userRef = doc(db, "users", user.uid);
  onSnapshot(userRef, snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    document.getElementById("user-name").textContent = data.username;
    updateBalanceDisplay(data.balance);

    document.getElementById("profile-username").textContent = data.username;
    document.getElementById("profile-uid").textContent = user.uid.slice(0, 8);
    document.getElementById("profile-renewal").textContent = new Date(data.renewalDate).toLocaleDateString();
    document.getElementById("profile-expiration").textContent = new Date(data.expirationDate).toLocaleDateString();
    document.getElementById("renewal-status").textContent = data.renewalPending ? "Pending Approval" : "Active";

    document.getElementById("history-table").innerHTML = (data.history || [])
<<<<<<< HEAD
      .map(h => `<tr><td class="history-${h.type}">${h.message} <small style="color:#666;">${h.timestamp ? new Date(h.timestamp).toLocaleString() : ""}</small></td></tr>`).join("");
=======
      .map(h => `<tr><td class="history-${h.type}">${h.message}</td></tr>`).join("");
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c

    if (data.isAdmin) {
      document.getElementById("open-admin").classList.remove("hidden");
      loadRenewalRequests();
    } else document.getElementById("open-admin").classList.add("hidden");
  });

  loadShop();
  loadJobs();
<<<<<<< HEAD
  loadInventory(user.uid);
=======
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
});

// ---------- SHOP ----------
function loadShop() {
  onSnapshot(collection(db, "shop"), snap => {
    const shopDiv = document.getElementById("shop-items");
    shopDiv.innerHTML = "";
    snap.forEach(docSnap => {
      const item = docSnap.data();
      const div = document.createElement("div");
      div.className = "item-card";
      const btn = document.createElement("button");
      btn.textContent = `${item.name} ($${item.cost})`;
      btn.onclick = () => buyItem(item.cost, item.name);
      div.appendChild(btn);
      shopDiv.appendChild(div);
    });
  });
}

<<<<<<< HEAD
// Purchase item using a transaction so balance + inventory update atomically
async function buyItem(cost, name) {
  try {
    const userRef = doc(db, "users", currentUser.uid);
    await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) throw new Error("User not found");
      const data = userSnap.data();
      const balance = data.balance || 0;
      if (balance < cost) throw new Error("Not enough balance");

      // update balance
      transaction.update(userRef, {
        balance: balance - cost
      });

      // update inventory (array on user doc)
      const inventory = data.inventory || [];
      const existing = inventory.find(i => i.name === name);
      if (existing) {
        existing.qty += 1;
      } else {
        inventory.push({ name, qty: 1 });
      }
      transaction.update(userRef, {
        inventory
      });

      // history
      const hist = data.history || [];
      hist.push({ type: "purchase", message: `Bought ${name} for $${cost}`, timestamp: Date.now() });
      transaction.update(userRef, { history: hist });
    });

    // UI update will be handled by onSnapshot listener
  } catch (err) {
    alert("Purchase failed: " + err.message);
  }
=======
async function buyItem(cost, name) {
  const userRef = doc(db, "users", auth.currentUser.uid);
  const snap = await getDoc(userRef);
  const data = snap.data();
  if (data.balance >= cost) {
    await updateDoc(userRef, {
      balance: increment(-cost),
      history: arrayUnion({ type: "purchase", message: `Bought ${name} for $${cost}` })
    });
    updateBalanceDisplay(data.balance - cost, "user-balance", "loss");
  } else alert("Not enough money!");
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
}

// ---------- JOBS ----------
function loadJobs() {
  onSnapshot(collection(db, "jobs"), snap => {
    const jobsDiv = document.getElementById("jobs");
    jobsDiv.innerHTML = "";
    snap.forEach(docSnap => {
      const job = docSnap.data();
      const btn = document.createElement("button");
      btn.textContent = `${job.name} (+$${job.pay})`;
      btn.onclick = () => doJob(job.pay, job.name);
      jobsDiv.appendChild(btn);
    });
  });
}

async function doJob(pay, jobName) {
<<<<<<< HEAD
  try {
    const userRef = doc(db, "users", currentUser.uid);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) throw new Error("User not found");
      const data = snap.data();
      const balance = data.balance || 0;

      transaction.update(userRef, {
        balance: balance + pay
      });
      const history = data.history || [];
      history.push({ type: "job", message: `Earned $${pay} from ${jobName}`, timestamp: Date.now() });
      transaction.update(userRef, { history });
    });
    // UI updated via snapshot
  } catch (err) {
    alert("Job failed: " + err.message);
  }
}

// ---------- TRANSFER ----------
// find user UID by usernameLower (fast indexed query)
async function getUidByUsernameLower(usernameLower) {
  const q = query(collection(db, "users"), where("usernameLower", "==", usernameLower));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].id;
}

document.getElementById("transfer-btn").addEventListener("click", async () => {
  const toUserInput = document.getElementById("transfer-to").value.trim().toLowerCase();
  const amount = parseFloat(document.getElementById("transfer-amount").value);
  if (!toUserInput || isNaN(amount) || amount <= 0) return alert("Enter valid username and amount");

  try {
    const senderUid = currentUser.uid;
    const recipientUid = await getUidByUsernameLower(toUserInput);
    if (!recipientUid) return alert("Recipient not found");
    if (recipientUid === senderUid) return alert("Cannot transfer to yourself");

    const senderRef = doc(db, "users", senderUid);
    const recipientRef = doc(db, "users", recipientUid);

    await runTransaction(db, async (transaction) => {
      const sSnap = await transaction.get(senderRef);
      const rSnap = await transaction.get(recipientRef);
      if (!sSnap.exists() || !rSnap.exists()) throw new Error("User not found");

      const sData = sSnap.data();
      const rData = rSnap.data();
      const sBalance = sData.balance || 0;

      if (sBalance < amount) throw new Error("Insufficient funds");

      transaction.update(senderRef, { balance: sBalance - amount });
      transaction.update(recipientRef, { balance: (rData.balance || 0) + amount });

      const sHist = sData.history || [];
      sHist.push({ type: "transfer", message: `Sent $${amount} to ${rData.username}`, timestamp: Date.now() });
      transaction.update(senderRef, { history: sHist });

      const rHist = rData.history || [];
      rHist.push({ type: "transfer", message: `Received $${amount} from ${sData.username}`, timestamp: Date.now() });
      transaction.update(recipientRef, { history: rHist });
    });

    document.getElementById("transfer-to").value = "";
    document.getElementById("transfer-amount").value = "";
    // UI balance flashes when onSnapshot updates
  } catch (err) {
    alert("Transfer failed: " + err.message);
  }
=======
  const userRef = doc(db, "users", auth.currentUser.uid);
  const snap = await getDoc(userRef);
  const data = snap.data();
  await updateDoc(userRef, {
    balance: increment(pay),
    history: arrayUnion({ type: "job", message: `Earned $${pay} from ${jobName}` })
  });
  updateBalanceDisplay(data.balance + pay, "user-balance", "gain");
}

// ---------- TRANSFER ----------
document.getElementById("transfer-btn").addEventListener("click", async () => {
  const toUserInput = document.getElementById("transfer-to").value.trim().toLowerCase();
  const amount = parseInt(document.getElementById("transfer-amount").value);
  if (!toUserInput || isNaN(amount) || amount <= 0) return alert("Enter valid username and amount");

  const senderRef = doc(db, "users", auth.currentUser.uid);
  const senderSnap = await getDoc(senderRef);
  const senderData = senderSnap.data();
  if (senderData.balance < amount) return alert("Not enough balance");

  // Case-insensitive username query
  const q = query(collection(db, "users"));
  const usersSnap = await getDocs(q);
  let receiverRef = null;
  let receiverData = null;
  usersSnap.forEach(u => {
    if (u.data().username.toLowerCase() === toUserInput) {
      receiverRef = u.ref;
      receiverData = u.data();
    }
  });
  if (!receiverRef) return alert("Recipient not found");

  // Update sender balance
  await updateDoc(senderRef, {
    balance: increment(-amount),
    history: arrayUnion({ type: "transfer", message: `Sent $${amount} to ${receiverData.username}` })
  });
  updateBalanceDisplay(senderData.balance - amount, "user-balance", "loss");

  // Update receiver balance
  await updateDoc(receiverRef, {
    balance: increment(amount),
    history: arrayUnion({ type: "transfer", message: `Received $${amount} from ${senderData.username}` })
  });

  document.getElementById("transfer-to").value = "";
  document.getElementById("transfer-amount").value = "";
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
});

// ---------- PROFILE RENEWAL ----------
document.getElementById("renew-btn").addEventListener("click", async () => {
<<<<<<< HEAD
  try {
    const userRef = doc(db, "users", currentUser.uid);
    await updateDoc(userRef, { renewalPending: true });
    alert("Renewal request sent. Waiting for admin approval.");
  } catch (err) {
    alert("Could not send renewal request: " + err.message);
  }
=======
  const userRef = doc(db, "users", auth.currentUser.uid);
  await updateDoc(userRef, { renewalPending: true });
  alert("Renewal request sent. Waiting for admin approval.");
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
});

// ---------- ADMIN PANEL ----------
document.getElementById("open-admin").addEventListener("click", () => document.getElementById("admin-panel").classList.remove("hidden"));
document.getElementById("back-to-dashboard").addEventListener("click", () => document.getElementById("admin-panel").classList.add("hidden"));

document.getElementById("add-item-btn").addEventListener("click", async () => {
  const name = document.getElementById("new-item-name").value.trim();
<<<<<<< HEAD
  const cost = parseFloat(document.getElementById("new-item-price").value);
=======
  const cost = parseInt(document.getElementById("new-item-price").value);
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
  if (!name || isNaN(cost)) return alert("Enter valid item and cost");
  await addDoc(collection(db, "shop"), { name, cost });
  document.getElementById("new-item-name").value = "";
  document.getElementById("new-item-price").value = "";
});

document.getElementById("add-job-btn").addEventListener("click", async () => {
  const name = document.getElementById("new-job-name").value.trim();
<<<<<<< HEAD
  const pay = parseFloat(document.getElementById("new-job-pay").value);
=======
  const pay = parseInt(document.getElementById("new-job-pay").value);
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
  if (!name || isNaN(pay)) return alert("Enter valid job and pay");
  await addDoc(collection(db, "jobs"), { name, pay });
  document.getElementById("new-job-name").value = "";
  document.getElementById("new-job-pay").value = "";
});

// ---------- ADMIN GIVE MONEY ----------
let currentAdminSnapUnsub = null;
const adminUsernameInput = document.getElementById("admin-give-username");
const adminUserBalanceElem = document.getElementById("admin-user-balance");

adminUsernameInput.addEventListener("input", async () => {
  const username = adminUsernameInput.value.trim();
  if (currentAdminSnapUnsub) currentAdminSnapUnsub();

  if (!username) {
    adminUserBalanceElem.textContent = "Balance: N/A";
    adminUserBalanceElem.className = "";
    return;
  }

<<<<<<< HEAD
  const q = query(collection(db,"users"), where("usernameLower", "==", username.toLowerCase()));
  const usersSnap = await getDocs(q);
  if (usersSnap.empty) {
=======
  const q = query(collection(db,"users"));
  const usersSnap = await getDocs(q);
  let userRef = null;
  usersSnap.forEach(u => {
    if (u.data().username.toLowerCase() === username.toLowerCase()) userRef = u.ref;
  });

  if (!userRef) {
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
    adminUserBalanceElem.textContent = "User not found";
    adminUserBalanceElem.className = "";
    return;
  }

<<<<<<< HEAD
  const userRef = usersSnap.docs[0].ref;
=======
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
  currentAdminSnapUnsub = onSnapshot(userRef, snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    updateBalanceDisplay(data.balance, "admin-user-balance");
  });
});

document.getElementById("admin-give-btn").addEventListener("click", async () => {
  const username = adminUsernameInput.value.trim();
<<<<<<< HEAD
  const amount = parseFloat(document.getElementById("admin-give-amount").value);
  if (!username || isNaN(amount)) return alert("Enter valid username and amount");

  const q = query(collection(db,"users"), where("usernameLower", "==", username.toLowerCase()));
  const usersSnap = await getDocs(q);
  if (usersSnap.empty) return alert("User not found");
  const userRef = usersSnap.docs[0].ref;
  const data = usersSnap.docs[0].data();

  await updateDoc(userRef, {
    balance: increment(amount),
    history: arrayUnion({ type: "admin", message: `Admin gave $${amount}`, timestamp: Date.now() })
  });
  updateBalanceDisplay((data.balance || 0) + amount, "admin-user-balance", "admin");
=======
  const amount = parseInt(document.getElementById("admin-give-amount").value);
  if (!username || isNaN(amount)) return;
  if (!confirm(`Are you sure you want to give $${amount} to ${username}?`)) return;

  const q = query(collection(db,"users"));
  const usersSnap = await getDocs(q);
  let userRef = null;
  let data = null;
  usersSnap.forEach(u => {
    if (u.data().username.toLowerCase() === username.toLowerCase()) {
      userRef = u.ref;
      data = u.data();
    }
  });

  if (!userRef) return alert("User not found");

  await updateDoc(userRef, {
    balance: increment(amount),
    history: arrayUnion({ type: "admin", message: `Admin gave $${amount}` })
  });
  updateBalanceDisplay(data.balance + amount, "admin-user-balance", "admin");

>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
  alert(`$${amount} added to ${username}'s account.`);
});

// ---------- ADMIN: RENEWAL REQUESTS ----------
function loadRenewalRequests() {
  const renewDiv = document.getElementById("renewal-requests");
  onSnapshot(query(collection(db,"users"), where("renewalPending","==",true)), snap => {
    renewDiv.innerHTML = "";
    snap.forEach(docSnap => {
      const user = docSnap.data();
      const div = document.createElement("div");
      div.className = "renew-request";
      div.textContent = `${user.username} (${docSnap.id.slice(0,8)}) wants renewal`;
      const btn = document.createElement("button");
      btn.textContent = "Approve";
      btn.onclick = async () => {
        const now = new Date();
        const expiration = new Date(now);
        expiration.setFullYear(now.getFullYear() + 1);
        await updateDoc(docSnap.ref, {
          renewalDate: now.toISOString(),
          expirationDate: expiration.toISOString(),
          renewalPending: false
        });
      };
      div.appendChild(btn);
      renewDiv.appendChild(div);
    });
  });
}

<<<<<<< HEAD
// ---------- INVENTORY SYSTEM ----------
// loadInventory: listens to current user's doc and displays inventory + total value
async function loadInventory(uid) {
  const invDiv = document.getElementById("inventory-items");
  const invValueElem = document.getElementById("inventory-value");
  const userRef = doc(db, "users", uid);

  // get shop prices once
  const shopSnap = await getDocs(collection(db, "shop"));
  const priceMap = {};
  shopSnap.forEach(docSnap => {
    const item = docSnap.data();
    priceMap[item.name] = item.cost;
  });

  onSnapshot(userRef, snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    const inventory = data.inventory || [];

    // Calculate total value (sell-back at 50%)
    const totalValue = inventory.reduce((sum, item) => {
      const value = priceMap[item.name] || 0;
      return sum + (value * item.qty * 0.5);
    }, 0);

    invValueElem.textContent = `Total Value: $${totalValue.toFixed(2)}`;

    // render
    if (inventory.length === 0) {
      invDiv.innerHTML = "<p>No items owned.</p>";
      return;
    }

    invDiv.innerHTML = "";
    inventory.forEach((item, index) => {
      const div = document.createElement("div");
      div.className = "inventory-item";
      const sellValue = Math.floor((priceMap[item.name] || 0) * 0.5 * item.qty);
      div.innerHTML = `
        <h4>${item.name}</h4>
        <p>Qty: ${item.qty}</p>
        <p>Sell Value: $${sellValue}</p>
        <button class="use-item">Use</button>
        <button class="sell-item">Sell</button>
      `;
      const useBtn = div.querySelector(".use-item");
      const sellBtn = div.querySelector(".sell-item");
      useBtn.onclick = () => useItem(uid, index);
      sellBtn.onclick = () => sellItem(uid, index, item.name, item.qty);
      invDiv.appendChild(div);
    });
  });
}

// Use item (reduces qty by 1 and adds to history)
async function useItem(uid, index) {
  try {
    const userRef = doc(db, "users", uid);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) throw new Error("User not found");
      const data = snap.data();
      const inventory = data.inventory || [];
      if (!inventory[index]) throw new Error("Item not found");
      const itemName = inventory[index].name;

      // decrement / remove
      inventory[index].qty -= 1;
      if (inventory[index].qty <= 0) inventory.splice(index, 1);

      const history = data.history || [];
      history.push({ type: "item", message: `Used ${itemName}`, timestamp: Date.now() });

      transaction.update(userRef, { inventory, history });
    });
  } catch (err) {
    alert("Use item failed: " + err.message);
  }
}

// Sell item for 50% of shop price (atomic)
async function sellItem(uid, index, name, qty) {
  if (!confirm(`Sell ${qty} x ${name} for 50% of shop price?`)) return;
  try {
    const userRef = doc(db, "users", uid);
    // read shop price
    const shopSnap = await getDocs(query(collection(db, "shop"), where("name","==",name)));
    let price = 0;
    shopSnap.forEach(s => { price = s.data().cost; });

    const refundPerItem = price * 0.5;
    const totalRefund = Math.floor(refundPerItem * qty);

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) throw new Error("User not found");
      const data = snap.data();
      const inventory = data.inventory || [];
      if (!inventory[index]) throw new Error("Item not found");

      // remove the item entry
      inventory.splice(index, 1);

      const history = data.history || [];
      history.push({ type: "sale", message: `Sold ${qty} x ${name} for $${totalRefund}`, timestamp: Date.now() });

      transaction.update(userRef, {
        inventory,
        balance: (data.balance || 0) + totalRefund,
        history
      });
    });
  } catch (err) {
    alert("Sell failed: " + err.message);
  }
}

=======
>>>>>>> 1f90dd1d0cf03815e58191905c61c7ce039efe6c
// ---------- LOGOUT ----------
document.getElementById("logout-btn").addEventListener("click", async () => {
  await signOut(auth);
  document.getElementById("login-username").value = "";
  document.getElementById("login-password").value = "";
  document.getElementById("admin-panel").classList.add("hidden");
  document.getElementById("dashboard-navbar").classList.add("hidden");
});
