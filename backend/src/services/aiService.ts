import OpenAI from "openai";
import { Pool } from "pg";
import { config } from "../config";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// PostgreSQL pool (assuming config has pg settings)
const pool = new Pool({
  connectionString: config.POSTGRES_URL,
});

export async function generateSchemaFromPrompt(prompt: string): Promise<string> {
  const resp = await openai.chat.completions.create({
    model: "gpt-4",  // or whichever model is set
    messages: [
      { role: "system", content: "You are a helpful assistant that writes SQL schema." },
      { role: "user", content: `Generate SQL schema for: ${prompt}` },
    ],
  });

  const schemaSql = resp.choices[0].message?.content?.trim() || "";
  return schemaSql;
}

export async function executeSQL(sql: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
