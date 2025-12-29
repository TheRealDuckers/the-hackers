const fetch = require("node-fetch");

async function dmUser(slackId, text) {
  if (!process.env.SLACK_BOT_TOKEN) {
    console.error("Missing SLACK_BOT_TOKEN");
    return;
  }

  if (!slackId) {
    console.error("No Slack ID provided");
    return;
  }

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Bearer ${process.env.SLACK_BOT_TOKEN}`
      },
      body: JSON.stringify({
        channel: slackId,   // DM the user directly
        text
      })
    });

    const data = await res.json();

    if (!data.ok) {
      console.error("Slack API error:", data);
    }
  } catch (err) {
    console.error("Failed to send Slack DM:", err);
  }
}

module.exports = { dmUser };
