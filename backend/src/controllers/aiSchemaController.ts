import { Request, Response } from "express";
import { generateSchemaFromPrompt, executeSQL } from "../services/aiService";

export async function aiGenerateSchema(req: Request, res: Response) {
  const { prompt, runSql } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  try {
    const sql = await generateSchemaFromPrompt(prompt);

    if (runSql) {
      await executeSQL(sql);
    }

    return res.json({ sql, executed: Boolean(runSql) });
  } catch (err: any) {
    console.error("AI Schema error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
