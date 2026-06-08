require("dotenv").config();

const express = require("express");
const OpenAI = require("openai");
const twilio = require("twilio");
const { Redis } = require("@upstash/redis");
const reservationService = require("./reservationService");

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
    if (!stored) return [];
    if (Array.isArray(stored)) return stored;
    return Array.isArray(stored.history) ? stored.history : [];
  }
  const stored = memoryStore.get(phone);
  if (!stored) return [];
  if (Array.isArray(stored)) return stored;
  return Array.isArray(stored.history) ? stored.history : [];
}

async function isReservationSaved(phone) {
  if (redis) {
    const stored = await redis.get(historyKey(phone));
    if (stored && !Array.isArray(stored)) {
      return !!stored.reservation_saved;
    }
  } else {
    const stored = memoryStore.get(phone);
    if (stored && !Array.isArray(stored)) {
      return !!stored.reservation_saved;
    }
  }
  return false;
}

async function saveHistory(phone, history, reservation_saved = false) {
  const trimmed =
    history.length > MAX_HISTORY_MESSAGES
      ? history.slice(-MAX_HISTORY_MESSAGES)
      : history;

  const data = {
    history: trimmed,
    reservation_saved
  };

  if (redis) {
    await redis.set(historyKey(phone), data, {
      ex: CONVERSATION_TTL_SECONDS,
    });
  } else {
    memoryStore.set(phone, data);
  }

  return trimmed;
}

async function addMessage(phone, role, content) {
  const history = await getHistory(phone);
  history.push({ role, content });
  const saved = await isReservationSaved(phone);
  return saveHistory(phone, history, saved);
}

async function markReservationSaved(phone) {
  const history = await getHistory(phone);
  return saveHistory(phone, history, true);
}

async function extractReservationDetails(history) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  // Get current local time for date resolution context
  const currentDateTime = new Date().toLocaleString("en-US", { timeZone: "Europe/Riga" });

  const messages = [
    {
      role: "system",
      content:
        "Tev ir jāanalizē restorāna rezervācijas saruna un jānosaka, vai ir pilnībā savākta visa nepieciešamā informācija rezervācijai.\n" +
        "Nepieciešamā informācija ir:\n" +
        "1. Klienta vārds (customer_name) - jābūt tekstam.\n" +
        "2. Cilvēku/viesu skaits (guests) - jābūt veselam skaitlim (integer).\n" +
        "3. Rezervācijas datums (reservation_date) - jābūt DATE formātā: YYYY-MM-DD. Ja klients raksta relatīvu datumu (piem., 'rīt' vai 'piektdien') vai nepilnu datumu (piem., '4. augustā'), pārvērt to reālā datumā formātā YYYY-MM-DD, izmantojot sniegto pašreizējo datumu/laiku.\n" +
        "4. Rezervācijas laiks (reservation_time) - jābūt TIME formātā: HH:MM (24 stundu formāts, piemēram, 18:00 vai 19:30).\n\n" +
        "Šodienas pašreizējais datums un laiks kontekstam: " + currentDateTime + ".\n\n" +
        "Svarīgi noteikumi:\n" +
        "- Ja kāds no 4 parametriem trūkst vai klients vēl nav pabeidzis vai apstiprinājis rezervāciju sarunā (piem., asistents vēl nav apliecinājis, ka rezervācija ir pabeigta, vai klients vēl svārstās), laukam all_collected jābūt false un visiem pārējiem laukiem jābūt null.\n" +
        "- Tikai tad, kad visi 4 parametri ir skaidri zināmi, all_collected ir true."
    },
    {
      role: "user",
      content: `Sarunas vēsture:\n${JSON.stringify(history, null, 2)}`
    }
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "reservation_extraction",
        strict: true,
        schema: {
          type: "object",
          properties: {
            all_collected: { type: "boolean" },
            customer_name: { type: ["string", "null"] },
            guests: { type: ["integer", "null"] },
            reservation_date: { type: ["string", "null"] },
            reservation_time: { type: ["string", "null"] }
          },
          required: ["all_collected", "customer_name", "guests", "reservation_date", "reservation_time"],
          additionalProperties: false
        }
      }
    },
    temperature: 0.0
  });

  try {
    const content = response.choices[0]?.message?.content;
    if (!content) return { all_collected: false };
    return JSON.parse(content);
  } catch (error) {
    console.error("[Extractor] Failed to parse JSON response:", error);
    return { all_collected: false };
  }
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

    // Supabase Integration: Extract and save reservation info
    try {
      const saved = await isReservationSaved(from);
      if (saved) {
        console.log(`[Reservation] Skip extraction: Reservation already saved for ${from} in this conversation.`);
      } else {
        const extraction = await extractReservationDetails(historyAfter);
        console.log("[Reservation] Extracted details:", extraction);

        if (extraction && extraction.all_collected) {
          const { customer_name, guests, reservation_date, reservation_time } = extraction;

          // Double check that all 4 fields exist and are valid (not null/undefined/empty)
          if (
            customer_name != null &&
            guests != null &&
            reservation_date != null &&
            reservation_time != null
          ) {
            console.log(`[Reservation] Creating reservation in database for name: ${customer_name}, phone: ${from}, guests: ${guests}, date: ${reservation_date}, time: ${reservation_time}...`);
            
            const result = await reservationService.createReservation({
              phone_number: from,
              customer_name,
              guests,
              reservation_date,
              reservation_time
            });

            if (result.isNew) {
              console.log(`[Reservation] Reservation created. ID: ${result.id}`);
              console.log("[Reservation] Reservation data:", JSON.stringify(result.data, null, 2));
            } else {
              console.log(`[Reservation] Duplicate reservation detected. Existing ID: ${result.id}`);
            }

            // Mark reservation as saved in the conversation state
            await markReservationSaved(from);
            console.log(`[Reservation] Flagged reservation_saved = true for phone: ${from}`);
          } else {
            console.log("[Reservation] Extraction reported all_collected but missing required fields. Skipped saving.");
          }
        } else {
          console.log("[Reservation] Reservation is not yet fully collected.");
        }
      }
    } catch (dbError) {
      console.error("[Reservation] Error in Supabase reservation flow:", dbError.message || dbError);
    }

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
