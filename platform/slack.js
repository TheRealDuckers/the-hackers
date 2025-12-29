const fetch = require("node-fetch");

async function sendSlackMessage(text) {
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

module.exports = { sendSlackMessage };
