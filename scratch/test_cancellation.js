const assert = require("assert");
const reservationService = require("../reservationService");
const app = require("../server");

// We will stub the database calls on reservationService
let mockReservations = {};
let cancelCalledId = null;

reservationService.findLatestActiveReservation = async (phone) => {
  return Object.values(mockReservations).find(
    (r) => r.phone_number === phone && r.status === "confirmed"
  ) || null;
};

reservationService.findReservationById = async (id) => {
  return mockReservations[id] || null;
};

reservationService.cancelReservation = async (id) => {
  cancelCalledId = id;
  if (mockReservations[id]) {
    mockReservations[id].status = "cancelled";
  }
  return mockReservations[id];
};

// Start local Express server on dynamic port
const server = app.listen(0);
const port = server.address().port;
const url = `http://localhost:${port}/sms`;

async function sendSms(message, fromPhone) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Body: message, From: fromPhone })
  });
  const text = await res.text();
  // Extract twiml message
  const match = text.match(/<Message>(.*?)<\/Message>/);
  return match ? match[1] : text;
}

async function runTests() {
  let passed = true;

  try {
    // ----------------------------------------------------
    // Scenario A: Reservation exists -> cancel -> confirms (YES) -> status = cancelled
    // ----------------------------------------------------
    console.log("Running Scenario A...");
    mockReservations = {
      "res-1": {
        id: "res-1",
        customer_name: "Marko",
        phone_number: "+37120000000",
        guests: 4,
        reservation_date: "2026-08-04",
        reservation_time: "18:00",
        status: "confirmed"
      }
    };
    cancelCalledId = null;

    let reply = await sendSms("atcelt", "+37120000000");
    assert.strictEqual(reply, "Atcelt? JA/NE");
    console.log("  Step 1 PASS (prompt returned correctly)");

    reply = await sendSms("jā", "+37120000000");
    assert.strictEqual(reply, "Jūsu rezervācija ir veiksmīgi atcelta.");
    assert.strictEqual(cancelCalledId, "res-1");
    assert.strictEqual(mockReservations["res-1"].status, "cancelled");
    console.log("  Step 2 PASS (cancellation confirmed and database updated)");

    // ----------------------------------------------------
    // Scenario B: Reservation exists -> cancel -> declines (NO) -> status remains confirmed
    // ----------------------------------------------------
    console.log("\nRunning Scenario B...");
    mockReservations = {
      "res-2": {
        id: "res-2",
        customer_name: "Arturs",
        phone_number: "+37120000000",
        guests: 2,
        reservation_date: "2026-08-10",
        reservation_time: "19:00",
        status: "confirmed"
      }
    };
    cancelCalledId = null;

    reply = await sendSms("cancel", "+37120000000");
    assert.strictEqual(reply, "Atcelt? JA/NE");
    console.log("  Step 1 PASS (prompt returned correctly)");

    reply = await sendSms("nē", "+37120000000");
    assert.strictEqual(reply, "Rezervācija netika atcelta.");
    assert.strictEqual(cancelCalledId, null);
    assert.strictEqual(mockReservations["res-2"].status, "confirmed");
    console.log("  Step 2 PASS (cancellation declined and database remains confirmed)");

    // ----------------------------------------------------
    // Scenario C: No reservation exists
    // ----------------------------------------------------
    console.log("\nRunning Scenario C...");
    mockReservations = {};
    reply = await sendSms("cancel reservation", "+37120000000");
    assert.strictEqual(reply, "Jums nav aktīvu rezervāciju.");
    console.log("  PASS (correct error reply)");

    // ----------------------------------------------------
    // Scenario D: Wrong phone number -> cannot cancel
    // ----------------------------------------------------
    console.log("\nRunning Scenario D...");
    mockReservations = {
      "res-3": {
        id: "res-3",
        customer_name: "Marko",
        phone_number: "+37120000000",
        guests: 4,
        reservation_date: "2026-08-04",
        reservation_time: "18:00",
        status: "confirmed"
      }
    };
    cancelCalledId = null;

    // Send cancellation from a completely different number
    reply = await sendSms("atcelt", "+37129999999");
    assert.strictEqual(reply, "Jums nav aktīvu rezervāciju.");
    assert.strictEqual(cancelCalledId, null);
    console.log("  Step 1 PASS (correctly reported no active reservations for wrong phone)");

    // Test session hijack prevention:
    // Force set the pending_cancellation of "+37129999999" (wrong phone) to "res-3" (owned by "+37120000000")
    const serverInstance = require("../server");
    await serverInstance.setPendingCancellation("+37129999999", "res-3");

    reply = await sendSms("jā", "+37129999999");
    assert.strictEqual(reply, "Rezervācija netika atcelta.");
    assert.strictEqual(cancelCalledId, null);
    assert.strictEqual(mockReservations["res-3"].status, "confirmed");
    console.log("  Step 2 PASS (hijack attempt rejected correctly)");

    console.log("\nAll cancellation test scenarios passed!");
  } catch (error) {
    console.error("Test failed:", error);
    passed = false;
  } finally {
    server.close();
  }

  process.exit(passed ? 0 : 1);
}

runTests();
