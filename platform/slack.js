// slack.js
import fetch from "node-fetch";

export async function sendSlackMessage(text) {
  if (!process.env.SLACK_WEBHOOK_URL) {
    console.error("Missing SLACK_WEBHOOK_URL");
    return;
  }

  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}
