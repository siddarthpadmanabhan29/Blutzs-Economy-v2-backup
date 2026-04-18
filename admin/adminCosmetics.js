import { db } from "../firebaseConfig.js";
import { collection, doc, getDocs, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "../historyManager.js";
import { getDOMElements, handleUserLookup } from "./adminUtils.js";

let adminCosmeticsCache = null;

export function initCosmeticsUI() {
  const el = getDOMElements();
  
  if (el.adminCosmeticsUsername) {
    el.adminCosmeticsUsername.addEventListener("input", () => 
      handleUserLookup(el.adminCosmeticsUsername, el.adminCosmeticsUserInfo, null, "cosmetic")
    );
  }
}

export async function renderCosmeticsAdmin(userId, userData) {
  const el = getDOMElements();
  if (!el.adminCosmeticsList) {
    console.warn("adminCosmeticsList not found");
    return;
  }
  
  if (!adminCosmeticsCache) {
    try {
      adminCosmeticsCache = await getDocs(collection(db, "cosmeticsShop"));
    } catch (err) {
      console.error("Failed to load cosmetics shop:", err);
      el.adminCosmeticsList.innerHTML = "<p style='color: red;'>Error loading cosmetics</p>";
      return;
    }
  }
  
  if (adminCosmeticsCache.empty) {
    el.adminCosmeticsList.innerHTML = "<p style='color: gray;'>No cosmetics available</p>";
    return;
  }
  
  el.adminCosmeticsList.innerHTML = "";
  adminCosmeticsCache.forEach((docSnap) => {
    const item = docSnap.data();
    const owned = userData?.cosmeticsOwned?.[docSnap.id] === true;
    const div = document.createElement("div");
    div.style.display = "flex";
    div.style.justifyContent = "space-between";
    div.style.alignItems = "center";
    div.style.marginBottom = "10px";
    div.style.padding = "10px";
    div.style.background = "rgba(0,0,0,0.1)";
    div.style.borderRadius = "6px";
    div.innerHTML = `<span style="flex-grow: 1;">${item.name}</span><button style="cursor:pointer; padding: 6px 12px; border-radius: 4px; border: none; font-weight: bold; background: ${owned ? '#e74c3c' : '#2ecc71'}; color: white;">${owned ? "Revoke" : "Grant"}</button>`;
    div.querySelector("button").onclick = async () => {
      try {
        const cosmeticsOwned = { ...(userData?.cosmeticsOwned || {}) };
        if (owned) {
          delete cosmeticsOwned[docSnap.id];
        } else {
          cosmeticsOwned[docSnap.id] = true;
        }
        await updateDoc(doc(db, "users", userId), { cosmeticsOwned });
        await logHistory(userId, `Admin updated cosmetic: ${item.name}`, "admin");
        renderCosmeticsAdmin(userId, { ...userData, cosmeticsOwned });
      } catch (err) {
        console.error("Cosmetic update error:", err);
        alert("Failed to update cosmetic");
      }
    };
    el.adminCosmeticsList.appendChild(div);
  });
}

export { renderCosmeticsAdmin as default };
