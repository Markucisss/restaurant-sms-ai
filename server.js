require("dotenv").config();

const express = require("express");
const OpenAI = require("openai");
const twilio = require("twilio");
const { Redis } = require("@upstash/redis");

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const MAX_HISTORY_MESSAGES = 20;
const CONVERSATION_TTL_SECONDS = 7 * 24 * 60 * 60;

const SYSTEM_PROMPT =
  "Tu esi profesionāls restorāna rezervāciju administrators Latvijā. Runā tikai latviešu valodā. Palīdzi rezervēt galdiņus.\n\n" +
  "Tev jānoskaidro šāda informācija:\n" +
  "- cilvēku skaits\n" +
  "- datums\n" +
  "- laiks\n" +
  "- rezervācijas vārds\n\n" +
  "Svarīgi noteikumi:\n" +
  "- Izmanto visu iepriekšējo sarunu, lai saprastu, ko klients jau ir norādījis.\n" +
  "- Nekad neprasi informāciju, ko klients jau ir norādījis iepriekšējās ziņās.\n" +
  "- Ja vēl trūkst kāda informācija, jautā tikai to, kas trūkst.\n" +
  "- Kad ir zināms cilvēku skaits, datums, laiks un vārds, apstiprini rezervāciju.\n\n" +
  "Piemērs:\n" +
  "Klients: \"Vēlos rezervēt galdiņu 4 cilvēkiem 4. augustā plkst. 18:00\"\n" +
  "Tu: \"Uz kāda vārda veikt rezervāciju?\"\n" +
  "Klients: \"Marko\"\n" +
  "Tu: \"Paldies, Marko! Jūsu rezervācija 4 cilvēkiem ir pieņemta 4. augustā plkst. 18:00.\"";

const memoryStore = new Map();

function createRedisClient() {
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    return new Redis({ url, token });
  }
  return null;
}

const redis = createRedisClient();

if (redis) {
  console.log("[store] Using Redis for conversation history");
} else if (process.env.VERCEL) {
  console.warn(
    "[store] WARNING: No Redis configured on Vercel — conversation history will NOT persist between SMS messages. Add KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN."
  );
} else {
  console.log("[store] Using in-memory store for local development");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function historyKey(phone) {
  return `sms:conversation:${phone}`;
}

async function getHistory(phone) {
  if (redis) {
    const stored = await redis.get(historyKey(phone));
    return Array.isArray(stored) ? stored : [];
  }
  return memoryStore.get(phone) || [];
}

async function saveHistory(phone, history) {
  const trimmed =
    history.length > MAX_HISTORY_MESSAGES
      ? history.slice(-MAX_HISTORY_MESSAGES)
      : history;

  if (redis) {
    await redis.set(historyKey(phone), trimmed, {
      ex: CONVERSATION_TTL_SECONDS,
    });
  } else {
    memoryStore.set(phone, trimmed);
  }

  return trimmed;
}

async function addMessage(phone, role, content) {
  const history = await getHistory(phone);
  history.push({ role, content });
  return saveHistory(phone, history);
}

function sendTwiml(res, message) {
  const truncated =
    message.length > 1500 ? message.slice(0, 1497) + "..." : message;
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(truncated);
  res.type("text/xml");
  res.send(twiml.toString());
}

async function getAiReply(phone, incomingMessage) {
  const history = await getHistory(phone);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: incomingMessage },
  ];

  console.log("[OpenAI] Phone:", phone);
  console.log("[OpenAI] Messages sent:");
  console.log(JSON.stringify(messages, null, 2));

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    max_tokens: 500,
    temperature: 0.3,
  });

  return response.choices[0]?.message?.content?.trim() || "";
}

app.get("/", (req, res) => {
  console.log("[GET /] Health check");
  res.send("Restaurant SMS AI is running");
});

app.post("/sms", async (req, res) => {
  const incomingMessage = req.body.Body || "";
  const from = req.body.From || "unknown";
  const to = req.body.To || "unknown";

  console.log("[POST /sms] Incoming SMS:");
  console.log("  Phone:", from);
  console.log("  To:", to);
  console.log("  Body:", incomingMessage);

  const historyBefore = await getHistory(from);
  console.log(
    `[POST /sms] Conversation history for ${from} (${historyBefore.length} messages):`
  );
  console.log(JSON.stringify(historyBefore, null, 2));

  if (!process.env.OPENAI_API_KEY) {
    console.error("[POST /sms] Error: OPENAI_API_KEY is not set");
    return sendTwiml(
      res,
      "Atvainojiet, sistēma nav konfigurēta. Lūdzu, sazinieties ar restorānu."
    );
  }

  if (!incomingMessage.trim()) {
    console.log("[POST /sms] Empty message received");
    return sendTwiml(
      res,
      "Sveiki! Lūdzu, uzrakstiet ziņu, lai palīdzētu ar galdiņa rezervāciju."
    );
  }

  try {
    const aiReply = await getAiReply(from, incomingMessage);
    console.log("[POST /sms] OpenAI reply:", aiReply);

    if (!aiReply) {
      console.error("[POST /sms] Error: OpenAI returned empty response");
      return sendTwiml(
        res,
        "Atvainojiet, neizdevās izveidot atbildi. Lūdzu, mēģiniet vēlreiz."
      );
    }

    await addMessage(from, "user", incomingMessage);
    await addMessage(from, "assistant", aiReply);

    const historyAfter = await getHistory(from);
    console.log(
      `[POST /sms] Updated conversation history for ${from} (${historyAfter.length} messages):`
    );
    console.log(JSON.stringify(historyAfter, null, 2));

    sendTwiml(res, aiReply);
  } catch (error) {
    console.error("[POST /sms] Error calling OpenAI:");
    console.error("  Message:", error.message);
    if (error.status) console.error("  Status:", error.status);
    if (error.code) console.error("  Code:", error.code);
    console.error("  Stack:", error.stack);

    sendTwiml(
      res,
      "Atvainojiet, radās tehniska kļūda. Lūdzu, mēģiniet vēlreiz pēc brīža."
    );
  }
});

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log("OPENAI_API_KEY set:", !!process.env.OPENAI_API_KEY);
    console.log("Redis configured:", !!redis);
    console.log("TWILIO_ACCOUNT_SID set:", !!process.env.TWILIO_ACCOUNT_SID);
    console.log("TWILIO_AUTH_TOKEN set:", !!process.env.TWILIO_AUTH_TOKEN);
  });
}

module.exports = app;
