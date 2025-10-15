// ---------- jobs.js ----------
console.log("jobs.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
  doc, getDoc, updateDoc, getDocs, collection, onSnapshot, setDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { updateBalanceDisplay } from "./main.js";

// Container for job list
const jobsContainer = document.getElementById("jobs");

// Realtime listener for jobs
function loadJobs() {
  const jobsRef = collection(db, "jobs");
  onSnapshot(jobsRef, (snapshot) => {
    jobsContainer.innerHTML = "";

    if (snapshot.empty) {
      jobsContainer.innerHTML = "<p>No jobs available right now.</p>";
      return;
    }

    snapshot.forEach((docSnap) => {
      const job = docSnap.data();
      const jobCard = document.createElement("div");
      jobCard.classList.add("job-item");
      jobCard.innerHTML = `
        <strong>${job.name}</strong> - Pays $${job.pay}
        <button class="btn-primary work-btn" data-id="${docSnap.id}">Work</button>
      `;
      jobsContainer.appendChild(jobCard);
    });

    // Add button event listeners
    document.querySelectorAll(".work-btn").forEach((btn) => {
      btn.addEventListener("click", () => workJob(btn.dataset.id));
    });
  });
}

// Function to "work" a job (earn pay)
async function workJob(jobId) {
  const user = auth.currentUser;
  if (!user) return alert("You must be logged in.");

  const userRef = doc(db, "users", user.uid);
  const jobRef = doc(db, "jobs", jobId);

  const [userSnap, jobSnap] = await Promise.all([getDoc(userRef), getDoc(jobRef)]);
  if (!userSnap.exists() || !jobSnap.exists()) return;

  const userData = userSnap.data();
  const jobData = jobSnap.data();

  const newBalance = (userData.balance || 0) + (jobData.pay || 0);

  await updateDoc(userRef, { balance: newBalance });
  updateBalanceDisplay(newBalance, "user-balance", "gain");

  // Log the job income in history
  const historyRef = doc(collection(db, "history"));
  await setDoc(historyRef, {
    userId: user.uid,
    username: userData.username,
    type: "job",
    jobName: jobData.name,
    pay: jobData.pay,
    timestamp: Date.now(),
  });

  console.log(`Worked ${jobData.name} and earned $${jobData.pay}`);
  alert(`You worked as a ${jobData.name} and earned $${jobData.pay}!`);
}

// Initialize jobs once user logs in
auth.onAuthStateChanged((user) => {
  if (user) loadJobs();
});

export { loadJobs };
