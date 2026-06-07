require("dotenv").config();

const express = require("express");
const OpenAI = require("openai");
const twilio = require("twilio");

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const SYSTEM_PROMPT =
  "Tu esi profesionāls restorāna rezervāciju administrators Latvijā. Runā tikai latviešu valodā. Palīdzi rezervēt galdiņus. Noskaidro cilvēku skaitu, datumu, laiku un rezervācijas vārdu.";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function sendTwiml(res, message) {
  const truncated =
    message.length > 1500 ? message.slice(0, 1497) + "..." : message;
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(truncated);
  res.type("text/xml");
  res.send(twiml.toString());
}

async function getAiReply(incomingMessage) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: incomingMessage },
    ],
    max_tokens: 500,
    temperature: 0.7,
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
  console.log("  From:", from);
  console.log("  To:", to);
  console.log("  Body:", incomingMessage);

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
    const aiReply = await getAiReply(incomingMessage);
    console.log("[POST /sms] OpenAI reply:", aiReply);

    if (!aiReply) {
      console.error("[POST /sms] Error: OpenAI returned empty response");
      return sendTwiml(
        res,
        "Atvainojiet, neizdevās izveidot atbildi. Lūdzu, mēģiniet vēlreiz."
      );
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
    console.log("TWILIO_ACCOUNT_SID set:", !!process.env.TWILIO_ACCOUNT_SID);
    console.log("TWILIO_AUTH_TOKEN set:", !!process.env.TWILIO_AUTH_TOKEN);
  });
}

module.exports = app;
