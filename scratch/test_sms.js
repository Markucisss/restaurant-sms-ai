// Load environment variables
require("dotenv").config();

const express = require("express");
const app = require("../server");
const http = require("http");

function makePostRequest(port, path, body) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const req = http.request(
      {
        hostname: "localhost",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(data)
        }
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: responseBody
          });
        });
      }
    );

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function runSmsTest() {
  console.log("=== MOCK SMS HANDLER TEST ===");
  if (!process.env.OPENAI_API_KEY) {
    console.error("FAIL: OPENAI_API_KEY is not configured in .env.");
    process.exit(1);
  }

  // Start the server on a free port
  const server = app.listen(0, async () => {
    const port = server.address().port;
    console.log(`Test server started on port ${port}`);

    const testPhone = "+37188888888";

    try {
      // Message 1: Initial reservation request
      console.log("\n--- Sending message 1 ---");
      const res1 = await makePostRequest(port, "/sms", {
        From: testPhone,
        To: "+37120000000",
        Body: "Sveiki, vēlos pieteikt galdiņu 3 cilvēkiem šovakar plkst. 19:30."
      });
      console.log("Status:", res1.statusCode);
      console.log("Response TwiML:", res1.body);

      // Message 2: Providing the customer name
      console.log("\n--- Sending message 2 ---");
      const res2 = await makePostRequest(port, "/sms", {
        From: testPhone,
        To: "+37120000000",
        Body: "Mani sauc Roberts"
      });
      console.log("Status:", res2.statusCode);
      console.log("Response TwiML:", res2.body);

      console.log("\nSUCCESS: Conversation flow completed without throwing errors.");
    } catch (err) {
      console.error("Test error:", err);
    } finally {
      server.close(() => {
        console.log("Test server stopped.");
      });
    }
  });
}

runSmsTest();
