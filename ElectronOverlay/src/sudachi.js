const { spawn } = require("node:child_process");
const path = require("node:path");

const SUDACHI_TIMEOUT_MS = 3500;
const cache = new Map();

function analyzeWithSudachi({ text, splitMode = "C" }) {
  const normalizedText = String(text ?? "").trim();
  const normalizedMode = String(splitMode ?? "C").toUpperCase();
  const cacheKey = `${normalizedMode}:${normalizedText}`;

  if (!normalizedText) {
    return Promise.resolve({ reading: "", tokens: [] });
  }

  if (cache.has(cacheKey)) {
    return Promise.resolve(cache.get(cacheKey));
  }

  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "sudachi_analyze.py");
    const child = spawn("python", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Sudachi analysis timed out"));
    }, SUDACHI_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        reject(new Error(stderr || `Sudachi exited with code ${code}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        if (!parsed?.ok) {
          reject(new Error(parsed?.error || "Sudachi returned invalid output"));
          return;
        }

        const result = {
          reading: parsed.reading || "",
          tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
        };
        cache.set(cacheKey, result);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(JSON.stringify({ text: normalizedText, splitMode: normalizedMode }));
  });
}

module.exports = {
  analyzeWithSudachi,
};
