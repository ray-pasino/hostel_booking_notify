import { runScrape } from "../scraper.js";

export default async function handler(req, res) {
  try {
    const university =
      req.query?.university || "Ghana Communication Technology University";
    const result = await runScrape(university);
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
