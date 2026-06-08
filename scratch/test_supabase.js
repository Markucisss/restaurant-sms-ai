// Load environment variables
require("dotenv").config();

const { createReservation, supabaseClient } = require("../reservationService");

async function testSupabase() {
  console.log("=== SUPABASE INTEGRATION TEST ===");
  console.log("Supabase URL:", process.env.SUPABASE_URL ? "Configured" : "MISSING");
  console.log("Supabase Service Role Key:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "Configured" : "MISSING");

  if (!supabaseClient) {
    console.error("FAIL: Supabase client not initialized.");
    process.exit(1);
  }

  const testPhone = "+37199999999";
  const testDate = "2026-08-04";
  const testTime = "18:00";

  const testReservation = {
    customer_name: "Test Marko",
    phone_number: testPhone,
    guests: 4,
    reservation_date: testDate,
    reservation_time: testTime
  };

  try {
    // 0. Clean up any previous test record to make the test repeatable
    console.log("\n1. Cleaning up existing test records if any...");
    const { error: deleteError } = await supabaseClient
      .from("reservations")
      .delete()
      .eq("phone_number", testPhone);

    if (deleteError) {
      console.warn("Clean up warning (might be ok if table doesn't exist yet):", deleteError.message);
    } else {
      console.log("Clean up successful.");
    }

    // 2. Try inserting new reservation
    console.log("\n2. Attempting to insert new reservation...");
    const result1 = await createReservation(testReservation);
    console.log("Result 1 (isNew):", result1.isNew);
    console.log("Result 1 ID:", result1.id);
    console.log("Result 1 Data:", JSON.stringify(result1.data, null, 2));

    if (!result1.isNew || !result1.id) {
      throw new Error("Expected reservation to be created as new with a valid UUID.");
    }

    // 3. Try inserting the exact same reservation to test duplicate check
    console.log("\n3. Attempting to insert duplicate reservation...");
    const result2 = await createReservation(testReservation);
    console.log("Result 2 (isNew):", result2.isNew);
    console.log("Result 2 ID:", result2.id);

    if (result2.isNew) {
      throw new Error("Fail: Duplicate reservation was inserted as new!");
    }
    if (result2.id !== result1.id) {
      throw new Error(`Fail: Duplicate reservation ID (${result2.id}) did not match original ID (${result1.id})`);
    }

    console.log("\nSUCCESS: Supabase insert and duplicate prevention works perfectly!");
  } catch (error) {
    console.error("\nTEST FAILED:", error.message || error);
    process.exit(1);
  }
}

testSupabase();
