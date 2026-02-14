// slackNotifier.js
// Reusable function to send Slack notifications from the frontend

export async function sendSlackMessage(message) {
  if (!message || typeof message !== "string") {
    console.warn("Slack message is empty or not a string. Skipping send.");
    return;
  }

  try {
    const response = await fetch(
      "https://slack-webhook-lyart.vercel.app/api/sendSlack",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Slack request failed:", response.status, errorText);
      return;
    }

    const data = await response.json();
    if (data.success) {
      console.log("✅ Slack message sent:", message);
    } else {
      console.error("❌ Slack message failed:", data.error || "Unknown error");
    }
  } catch (err) {
    console.error("⚠️ Error sending Slack message:", err);
  }
}
