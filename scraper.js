import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer";
import puppeteerCore from "puppeteer-core";

const TARGET_URL = "https://student.myhostelonline.com/hostels";
const UNIVERSITY = "Ghana Communication Technology University";

async function launchBrowser() {
  if (process.env.VERCEL) {
    const executablePath = await chromium.executablePath();
    return puppeteerCore.launch({
      executablePath,
      headless: true,
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
    });
  }

  return puppeteer.launch({ headless: true });
}

async function fillNearbyUniversity(page, university) {
  await page.waitForSelector("label", { timeout: 20000 });

  const inputFound = await page.evaluate((labelText, value) => {
    const labels = Array.from(document.querySelectorAll("label"));
    const label = labels.find((el) => el.textContent?.includes(labelText));
    if (!label) return false;

    const scope = label.parentElement ?? document;
    const input = scope.querySelector("input");
    if (!input) return false;

    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));

    return true;
  }, "Nearby University", university);

  if (!inputFound) {
    throw new Error('Could not find input for label "Nearby University".');
  }
}

function parseCount(text) {
  const match = text.match(/(\d+)\s*hostels?/i);
  return match ? Number(match[1]) : null;
}

export async function runScrape(university = UNIVERSITY) {
  const browser = await launchBrowser();
  const logProgress = (message) => console.log(`[scrape] ${message}`);

  try {
    logProgress(`Starting scrape for "${university}"`);
    const page = await browser.newPage();
    logProgress(`Opening ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 60000 });
    logProgress('Page loaded, filling "Nearby University" field');
    await fillNearbyUniversity(page, university);
    logProgress("Waiting for results to update");
    await new Promise((resolve) => setTimeout(resolve, 4000));

    const result = await page.evaluate(() => {
      const normalize = (text) => (text ?? "").replace(/\s+/g, " ").trim();
      const clearFiltersLabel = "Clear all filters";
      const stripClearFilters = (text) =>
        normalize(text).replace(new RegExp(clearFiltersLabel, "ig"), "").trim();

      const bodyText = document.body?.innerText ?? "";
      const countText = bodyText.match(/\b\d+\s*hostels?\b/i)?.[0] ?? null;
      const possibleClearElements = Array.from(
        document.querySelectorAll("button, a, [role='button'], div, span, p")
      );
      const clearFiltersElement =
        possibleClearElements.find(
          (el) => normalize(el.textContent).toLowerCase() === clearFiltersLabel.toLowerCase()
        ) ?? null;

      let resultsFieldText = null;
      if (clearFiltersElement) {
        const candidateTexts = [
          clearFiltersElement.parentElement?.previousElementSibling?.textContent,
          clearFiltersElement.previousElementSibling?.textContent,
          clearFiltersElement.parentElement?.textContent,
          clearFiltersElement.closest("div")?.textContent,
          clearFiltersElement.parentElement?.parentElement?.textContent,
        ];

        for (const candidate of candidateTexts) {
          const cleaned = stripClearFilters(candidate);
          if (cleaned) {
            resultsFieldText = cleaned;
            break;
          }
        }
      }

      const possibleCardTitles = Array.from(
        document.querySelectorAll("section h3, article h3, [class*='hostel'] h3")
      )
        .map((el) => el.textContent?.trim())
        .filter(Boolean);

      return {
        countText,
        resultsFieldText,
        pageTitle: document.title,
        url: location.href,
        sampleHostels: possibleCardTitles.slice(0, 5),
      };
    });
    logProgress("Page data captured");

    return {
      result,
      searchedUniversity: university,
      hostelCount: parseCount(result.resultsFieldText ?? result.countText ?? "") ?? 0,
      rawResultsFieldText: result.resultsFieldText,
      rawCountText: result.countText,
      sampleHostels: result.sampleHostels,
      pageTitle: result.pageTitle,
      url: result.url,
    };
  } finally {
    logProgress("Closing browser");
    await browser.close();
  }
}
