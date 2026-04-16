import "dotenv/config";
import { runScrape } from "../scraper.js";

const university =
  process.env.HOSTEL_UNIVERSITY ?? "Ghana Communication Technology University";
const monitorIntervalMs = Number(process.env.MONITOR_INTERVAL_MS ?? 1000);
const runOnce = process.env.MONITOR_RUN_ONCE === "true";
let keepRunning = true;

if (!Number.isFinite(monitorIntervalMs) || monitorIntervalMs < 0) {
  throw new Error("MONITOR_INTERVAL_MS must be a number >= 0.");
}

process.on("SIGINT", () => {
  keepRunning = false;
  console.log("[monitor] Stopping monitor (SIGINT received)...");
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendArkeselSmsAlert(scrapeResult) {
  if (scrapeResult.hostelCount <= 0) return;

  const apiKey = process.env.ARKESEL_API_KEY;
  const sender = process.env.ARKESEL_SENDER_ID;
  const recipients = (process.env.ARKESEL_RECIPIENTS ?? process.env.ARKESEL_RECIPIENT ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const smsUrl = process.env.ARKESEL_SMS_URL ?? "https://sms.arkesel.com/api/v2/sms/send";

  if (!apiKey || !sender || recipients.length === 0) {
    throw new Error(
      "Arkesel SMS settings are missing. Set ARKESEL_API_KEY, ARKESEL_SENDER_ID, and ARKESEL_RECIPIENTS (or ARKESEL_RECIPIENT)."
    );
  }

  const body = [
    `Hostel results found: ${scrapeResult.hostelCount} for ${scrapeResult.searchedUniversity}.`,
    scrapeResult.rawResultsFieldText ? `Results: ${scrapeResult.rawResultsFieldText}` : null,
    scrapeResult.sampleHostels?.length
      ? `Sample hostels: ${scrapeResult.sampleHostels.join(", ")}`
      : null,
    `URL: ${scrapeResult.url}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(smsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      sender,
      message: body,
      recipients,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Arkesel SMS request failed (${response.status}): ${errorBody}`);
  }

  const responseBody = await response.text();
  console.log(`Arkesel SMS alert sent: ${responseBody}`);
}

function buildAlertKey(scrapeResult) {
  return JSON.stringify({
    hostelCount: scrapeResult.hostelCount,
    rawResultsFieldText: scrapeResult.rawResultsFieldText ?? "",
    sampleHostels: scrapeResult.sampleHostels ?? [],
  });
}

let lastAlertKey = null;

async function runMonitor() {
  console.log(
    `[monitor] Started for "${university}" with interval ${monitorIntervalMs}ms` +
      (runOnce ? " (run once mode)" : "")
  );

  while (keepRunning) {
    const cycleStart = Date.now();
    try {
      const result = await runScrape(university);
      console.log("Exact result field:");
      console.log(JSON.stringify(result.result, null, 2));
      console.log("Full response:");
      console.log(JSON.stringify(result, null, 2));

      if (result.hostelCount > 0) {
        const alertKey = buildAlertKey(result);
        if (alertKey !== lastAlertKey) {
          await sendArkeselSmsAlert(result);
          lastAlertKey = alertKey;
        } else {
          console.log("[monitor] Results still unchanged; skipping duplicate SMS.");
        }
      } else {
        lastAlertKey = null;
      }
    } catch (error) {
      console.error("[monitor] Cycle failed:", error);
    }

    if (runOnce) break;

    const elapsed = Date.now() - cycleStart;
    await sleep(Math.max(0, monitorIntervalMs - elapsed));
  }
}

await runMonitor();
