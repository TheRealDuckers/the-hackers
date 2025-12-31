// github.js
const express = require("express");
const router = express.Router();
const { App } = require("@octokit/app");
const { Octokit } = require("@octokit/rest");

// ------------------------------
// GitHub App Authentication
// ------------------------------
async function getOctokit() {
  console.log("\n🔐 [GitHub] Creating GitHub App instance…");

  const app = new App({
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  });

  console.log("🔑 [GitHub] Fetching installation access token…");

  const installationAccessToken = await app.getInstallationAccessToken({
    installationId: process.env.GITHUB_APP_INSTALLATION_ID,
  });

  console.log("✅ [GitHub] Token acquired.");

  return new Octokit({
    auth: installationAccessToken,
  });
}

// ------------------------------
// In‑memory file locks
// ------------------------------
const locks = {}; 
// Example: locks["README.md"] = { userId: "123", name: "Alex" }

// ------------------------------
// GET /api/files
// ------------------------------
router.get("/files", async (req, res) => {
  console.log("\n📁 [Files] Request to list repo files…");

  try {
    const octokit = await getOctokit();

    console.log("📡 [GitHub] Fetching repo root contents…");

    const { data } = await octokit.repos.getContent({
      owner: process.env.GITHUB_REPO_OWNER,
      repo: process.env.GITHUB_REPO_NAME,
      path: "",
    });

    const files = data
      .filter((item) => item.type === "file")
      .map((file) => file.name);

    console.log("📄 [Files] Found:", files);

    res.json(files);
  } catch (err) {
    console.error("❌ [Files] GitHub list error:", err);
    res.status(500).json({ error: "GitHub error" });
  }
});

// ------------------------------
// GET /api/files/:filename
// ------------------------------
router.get("/files/:filename", async (req, res) => {
  const filename = req.params.filename;
  const user = req.session.user;

  console.log(`\n📄 [File Open] ${user.name} requested: ${filename}`);

  try {
    const octokit = await getOctokit();

    console.log(`📡 [GitHub] Fetching file: ${filename}`);

    const file = await octokit.repos.getContent({
      owner: process.env.GITHUB_REPO_OWNER,
      repo: process.env.GITHUB_REPO_NAME,
      path: filename,
    });

    const content = Buffer.from(file.data.content, "base64").toString("utf8");

    // Check lock
    const lock = locks[filename];
    const canEdit = !lock || lock.userId === user.id;

    if (lock) {
      console.log(`🔒 [Lock] File locked by ${lock.name}`);
    }

    if (canEdit) {
      console.log(`📝 [Lock] ${user.name} now editing ${filename}`);
      locks[filename] = { userId: user.id, name: user.name };
    }

    res.json({
      content,
      canEdit,
      lockedBy: lock ? lock.name : null,
      sha: file.data.sha,
    });
  } catch (err) {
    console.error("❌ [File Open] GitHub read error:", err);
    res.status(500).json({ error: "GitHub error" });
  }
});

// ------------------------------
// POST /api/files/:filename
// ------------------------------
router.post("/files/:filename", async (req, res) => {
  const filename = req.params.filename;
  const { content } = req.body;
  const user = req.session.user;

  console.log(`\n💾 [Save] ${user.name} is saving ${filename}`);

  // Check lock
  const lock = locks[filename];
  if (lock && lock.userId !== user.id) {
    console.log(`❌ [Lock] Save blocked — locked by ${lock.name}`);
    return res.status(403).json({ error: "File locked by another user" });
  }

  try {
    const octokit = await getOctokit();

    console.log(`📡 [GitHub] Fetching current SHA for ${filename}`);

    const file = await octokit.repos.getContent({
      owner: process.env.GITHUB_REPO_OWNER,
      repo: process.env.GITHUB_REPO_NAME,
      path: filename,
    });

    const sha = file.data.sha;

    console.log("📝 [GitHub] Committing updated file…");

    await octokit.repos.createOrUpdateFileContents({
      owner: process.env.GITHUB_REPO_OWNER,
      repo: process.env.GITHUB_REPO_NAME,
      path: filename,
      message: `Edited ${filename} via The Hackers platform`,
      content: Buffer.from(content).toString("base64"),
      sha,
    });

    console.log(`✅ [Save] Commit pushed for ${filename}`);
    console.log(`🔓 [Lock] Releasing lock for ${filename}`);

    delete locks[filename];

    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Save] GitHub write error:", err);
    res.status(500).json({ error: "GitHub error" });
  }
});

module.exports = router;
