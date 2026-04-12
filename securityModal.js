// ---------- securityModal.js (PIN UI & HANDLER) ----------
import { verifyBpsPin, registerLoyalty } from "./bpsManager.js";

const modal = document.getElementById("bps-pin-modal");
const pinDisplay = document.getElementById("pin-display");
const modalTitle = document.getElementById("pin-modal-title");
const modalDesc = document.getElementById("pin-modal-desc");
const escBtn = document.getElementById("close-pin-btn");

let currentInput = "";
let pendingAction = null; 

/**
 * OPENS THE KEYPAD
 * @param {string} mode - 'register' or 'verify'
 * @param {function} callback - Function to run on success (receives pin string)
 * @param {string} customTitle - Optional custom text for the title
 */
export function openPinModal(mode, callback, customTitle = null) {
    currentInput = "";
    
    // Update labels based on mode or custom title
    if (customTitle) {
        modalTitle.innerText = customTitle.toUpperCase();
    } else if (mode === 'register') {
        modalTitle.innerText = "SET SECURITY PIN";
    } else {
        modalTitle.innerText = "SECURITY PIN";
    }

    modalDesc.innerText = mode === 'register' 
        ? "Choose a 4-digit code for your wallet" 
        : "Authorize Transaction";

    updateDisplay();
    pendingAction = { mode, callback };
    modal.classList.remove("hidden");
    modal.style.display = "flex";
}

window.closePinModal = function() {
    modal.style.display = "none";
    modal.classList.add("hidden");
    currentInput = "";
};

if (escBtn) {
    escBtn.onclick = () => window.closePinModal();
}

function updateDisplay() {
    const dots = "● ".repeat(currentInput.length);
    const blanks = "_ ".repeat(4 - currentInput.length);
    pinDisplay.innerText = dots + blanks;
}

// Handle Keypad Clicks
document.querySelectorAll(".key-btn").forEach(btn => {
    if (btn.id === "close-pin-btn") return;

    btn.onclick = () => {
        const val = btn.dataset.val;

        if (val === "clear") {
            currentInput = "";
        } else if (currentInput.length < 4) {
            currentInput += val;
            if (currentInput.length === 4) {
                // Auto-submit on 4th digit
                setTimeout(processSubmission, 300);
            }
        }
        updateDisplay();
    };
});

async function processSubmission() {
    if (currentInput.length !== 4) return;

    const { mode, callback } = pendingAction;
    const submittedPin = currentInput; // Save current input before clearing

    if (mode === 'register') {
        // Logic for first-time registration
        // Note: For "Change PIN", we don't call registerLoyalty here, 
        // we just pass the digits back to the dashboard.
        if (modalTitle.innerText.includes("NEW") || modalTitle.innerText.includes("VERIFICATION")) {
            window.closePinModal();
            if (callback) callback(submittedPin);
            return;
        }

        const result = await registerLoyalty(submittedPin);
        if (result.success) {
            window.closePinModal();
            if (callback) callback(submittedPin);
        } else {
            alert(result.message);
            currentInput = "";
            updateDisplay();
        }
    } else if (mode === 'verify') {
        const isValid = await verifyBpsPin(submittedPin);
        if (isValid) {
            window.closePinModal();
            // CRITICAL: Pass the pin digits back so dashboard can use them for changeBpsPin
            if (callback) callback(submittedPin); 
        } else {
            alert("🔒 ACCESS DENIED: Incorrect PIN.");
            currentInput = "";
            updateDisplay();
        }
    }
}