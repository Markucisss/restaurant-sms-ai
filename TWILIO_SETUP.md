# Twilio konfigurācija — Restaurant SMS AI

## Nepieciešamie Twilio dati

No [Twilio Console](https://console.twilio.com/) iegūsti:

| Mainīgais | Kur atrast |
|-----------|------------|
| **Account SID** | Dashboard → Account Info → Account SID |
| **Auth Token** | Dashboard → Account Info → Auth Token (klikšķini "Show") |
| **Twilio Phone Number** | Phone Numbers → Manage → Active numbers → izvēlies savu numuru |

> **Piezīme:** `TWILIO_ACCOUNT_SID` un `TWILIO_AUTH_TOKEN` ir jāpievieno Vercel Environment Variables (skatīt zemāk). Pašreizējā versijā tie nav obligāti webhook darbībai — Twilio nosūta SMS uz tavu serveri, un serveris atbild ar TwiML. Tomēr ieteicams tos saglabāt nākotnes paplašinājumiem (piem., SMS validācijai).

## 1. solis — Vercel deployment

1. Deploy projektu uz Vercel:
   ```bash
   vercel --prod
   ```
2. Vercel Dashboard → Project → **Settings** → **Environment Variables** pievieno:
   - `OPENAI_API_KEY` — tavs OpenAI API atslēga
   - `TWILIO_ACCOUNT_SID` — Twilio Account SID
   - `TWILIO_AUTH_TOKEN` — Twilio Auth Token
3. Pēc env mainīgo pievienošanas veic **Redeploy**.

## 2. solis — Webhook URL

Pēc deploy iegūsti savu Vercel URL, piemēram:
```
https://restaurant-sms-ai.vercel.app
```

**Webhook URL formāts:**
```
https://TAVS-VERCEL-URL/sms
```

Piemērs:
```
https://restaurant-sms-ai.vercel.app/sms
```

## 3. solis — Twilio Phone Number konfigurācija

1. Ej uz [Twilio Console → Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming)
2. Klikšķini uz sava Twilio tālruņa numura
3. Sadaļā **Messaging Configuration**:
   - **A MESSAGE COMES IN** → iestati uz **Webhook**
   - **URL:** `https://TAVS-VERCEL-URL/sms`
   - **HTTP Method:** `HTTP POST`
4. Saglabā (**Save configuration**)

## 4. solis — Pārbaude

1. Atver pārlūkā: `https://TAVS-VERCEL-URL/`
   - Jāredz: `Restaurant SMS AI is running`
2. Nosūti SMS uz savu Twilio numuru, piemēram:
   ```
   Sveiki, vēlos rezervēt galdiņu 4 cilvēkiem piektdien plkst. 19:00.
   ```
3. AI asistents atbildēs latviski ar jautājumiem par rezervāciju.

## Problēmu risināšana

| Problēma | Risinājums |
|----------|------------|
| Nav atbildes uz SMS | Pārbaudi, vai webhook URL ir pareizs un HTTP POST |
| "sistēma nav konfigurēta" | Pievieno `OPENAI_API_KEY` Vercel env un redeploy |
| 500 kļūda | Skatīt Vercel → Deployments → Functions → Logs |
| Tukša atbilde | Pārbaudi OpenAI API atslēgu un konta bilanci |

## Vercel logi

Vercel Dashboard → Project → **Logs** — tur redzēsi:
- `[POST /sms] Incoming SMS:` — ienākošā ziņa
- `[POST /sms] OpenAI reply:` — AI atbilde
- `[POST /sms] Error` — kļūdas
