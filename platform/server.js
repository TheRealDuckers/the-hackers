require("dotenv").config();
const express = require("express");
const session = require("express-session");
const fetch = require("node-fetch");
const fs = require("fs");
const { App } = require("@octokit/app");
const { Octokit } = require("@octokit/rest");

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
  u.searchParams.set("scope", "profile email slack_id");

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

// ⭐ DM the user
const slackId = user.identity.slack_id;
const name = user.identity.first_name;

if (slackId) {
  dmUser(
    slackId,
    {
      text: `Hey ${name}! You just logged in to The Hackers platform.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Hey ${name}! You just logged in to *The Hackers* platform.\nIf this wasn't you, notify security by pressing the button below..`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Not Me"
              },
              action_id: "not_me_pressed",
              style: "danger"
            },
          ]
        }
      ]
    }
  );
}

res.redirect("/");

});



// ----------------------
// Pages
// ----------------------

app.get("/", requireAuth, (req, res) => {
  const html = fs.readFileSync("./index.html", "utf8");
  res.send(
    html.replace(
      "{{CONTENT}}",
      `
      <h1 class="text-xl font-bold mb-4">Welcome, ${req.session.user.identity.first_name}
</h1>
<p>You shouldn't be here... Its not ready yet!</p>
      <a href="/files" class="text-blue-600 underline">View files</a>
    `
    )
  );
});

app.get("/files", requireAuth, async (req, res) => {
  const octokit = await getOctokit();
  const { data } = await octokit.repos.getContent({
    owner: process.env.GITHUB_REPO_OWNER,
    repo: process.env.GITHUB_REPO_NAME,
    path: "",
  });

  const files = data.filter((f) => f.type === "file");

  const list = files
    .map(
      (f) =>
        `<li><a class="text-blue-600 underline" href="/edit?path=${encodeURIComponent(
          f.path
        )}">${f.path}</a></li>`
    )
    .join("");

  const html = fs.readFileSync("./index.html", "utf8");
  res.send(html.replace("{{CONTENT}}", `<ul>${list}</ul>`));
});

app.get("/edit", requireAuth, async (req, res) => {
  const path = req.query.path;

  const octokit = await getOctokit();
  const { data } = await octokit.repos.getContent({
    owner: process.env.GITHUB_REPO_OWNER,
    repo: process.env.GITHUB_REPO_NAME,
    path,
  });

  const content = Buffer.from(data.content, data.encoding).toString("utf8");

  const html = fs.readFileSync("./index.html", "utf8");
  res.send(
    html.replace(
      "{{CONTENT}}",
      `
      <h1 class="text-xl font-bold mb-4">Editing ${path}</h1>
      <form method="POST" action="/save">
        <textarea name="content" class="w-full h-80 border p-2">${content}</textarea>
        <input type="hidden" name="path" value="${path}">
        <input type="hidden" name="sha" value="${data.sha}">
        <button class="mt-4 px-4 py-2 bg-blue-600 text-white rounded">Save</button>
      </form>
    `
    )
  );
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
