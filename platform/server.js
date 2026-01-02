require("dotenv").config();
const express = require("express");
const session = require("express-session");
const fetch = require("node-fetch");
const fs = require("fs");
const { App } = require("@octokit/app");
const { Octokit } = require("@octokit/rest");
const ALLOWED_EMAILS = process.env.ALLOWED_EMAILS
  ? process.env.ALLOWED_EMAILS.split(",").map(e => e.trim().toLowerCase())
  : [];
;
const path = require("path");



const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session
app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret",
    resave: false,
    saveUninitialized: false,
  })
);

// In-memory locks (optional)
const locks = {};

// GitHub App
const ghApp = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
});

async function getOctokit() {
  const token = await ghApp.getInstallationAccessToken({
    installationId: Number(process.env.GITHUB_APP_INSTALLATION_ID),
  });
  return new Octokit({ auth: token });
}

// Middleware
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// ----------------------
// Hack Club OAuth
// ----------------------

app.get("/login", (req, res) => {
  const u = new URL("https://auth.hackclub.com/oauth/authorize");
  u.searchParams.set("client_id", process.env.HACKCLUB_CLIENT_ID);
  u.searchParams.set("redirect_uri", process.env.HACKCLUB_REDIRECT_URI);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "profile email slack_id name");

  res.redirect(u.toString());
});



const { dmUser } = require("./slack.js");

app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;

  const tokenRes = await fetch("https://auth.hackclub.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.HACKCLUB_CLIENT_ID,
      client_secret: process.env.HACKCLUB_CLIENT_SECRET,
      redirect_uri: process.env.HACKCLUB_REDIRECT_URI,
      code,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await tokenRes.json();

  const userRes = await fetch("https://auth.hackclub.com/api/v1/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  const user = await userRes.json();


  req.session.user = user;


const email = user.identity?.email?.toLowerCase();

if (!ALLOWED_EMAILS.includes(email)) {
  console.log("❌ Unauthorized login attempt:", email);

  req.session.destroy(() => {
    res.sendFile(path.join(__dirname, "no-access.html"));
  });

  return;
}



  // ⭐ Correct name extraction
  const name =
    user.name ||
    user.identity?.name ||
    user.identity?.first_name ||
    user.identity?.email?.split("@")[0] ||
    "there";

  const slackId = user.identity.slack_id;

  if (slackId) {
    dmUser(slackId, {
      text: `Hey ${name}! You just logged in to The Hackers platform.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Hey ${name}! You just logged in to *The Hackers* platform.\nIf this wasn't you, notify security by pressing the button below.`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Not Me" },
              action_id: "not_me_pressed",
              style: "danger"
            }
          ]
        }
      ]
    });
  }

  res.redirect("/");
});




// ----------------------
// Pages
// ----------------------

app.get("/", requireAuth, (req, res) => {
  let html = fs.readFileSync(__dirname + "/home.html", "utf8");

  html = html.replace(/{{NAME}}/g, req.session.user.identity.first_name);

  res.send(html);
});






app.get("/files", requireAuth, async (req, res) => {
  try {
    const octokit = await getOctokit();

    const { data } = await octokit.repos.getContent({
      owner: process.env.GITHUB_REPO_OWNER,
      repo: process.env.GITHUB_REPO_NAME,
      path: "",
    });

    const files = data
      .filter((item) => item.type === "file")
      .map((file) => file.name);

    res.send(`
      <h1>Files in Repo</h1>
      <ul>
        ${files.map((f) => `<li>${f}</li>`).join("")}
      </ul>
    `);
  } catch (err) {
    console.error("GitHub error:", err);
    res.send("<h1>GitHub error — check logs</h1>");
  }
});




// ----------------------
// Save to GitHub
// ----------------------

app.post("/save", requireAuth, async (req, res) => {
  const { path, content, sha } = req.body;

  const octokit = await getOctokit();

  await octokit.repos.createOrUpdateFileContents({
    owner: process.env.GITHUB_REPO_OWNER,
    repo: process.env.GITHUB_REPO_NAME,
    path,
    message: `Update ${path} via web editor`,
    content: Buffer.from(content, "utf8").toString("base64"),
    sha,
  });

  res.redirect("/files");
});

// ----------------------

app.post("/slack/actions", express.urlencoded({ extended: true }), async (req, res) => {
  const payload = JSON.parse(req.body.payload);

  if (payload.type === "block_actions") {
    const action = payload.actions[0];

    if (action.action_id === "not_me_pressed") {
      // DM YOU (the admin)
      const adminSlackId = process.env.ADMIN_SLACK_ID;

      dmUser(adminSlackId, `⚠️ Someone clicked *Not Me* on a login alert.\nUser: ${payload.user.id}`);

      // Optional: respond to Slack so the button shows feedback
      return res.json({
        text: "Thanks — we’ve alerted the admin. If nothing happens in about 15mins, call @Duckers.",
        replace_original: false
      });
    }
  }

  res.sendStatus(200);
});


app.listen(process.env.PORT || 3000, () =>
  console.log("Running on http://localhost:3000")
);
