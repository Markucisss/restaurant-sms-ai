const assert = require("assert");
const app = require("./server");

// Retrieve exposed resolution functions from app
const resolveLatvianDate = app.resolveLatvianDate;
const resolveTime = app.resolveTime;

if (typeof resolveLatvianDate !== "function" || typeof resolveTime !== "function") {
  console.error("FAIL: Exposed resolution functions not found on the app object.");
  process.exit(1);
}

// Tests relative to current local time "2026-06-08T23:25:03+03:00"
const baseDate = new Date("2026-06-08T23:25:03+03:00");
const dateTests = [
  { input: "šodien", expected: "2026-06-08" },
  { input: "šovakar", expected: "2026-06-08" },
  { input: "rīt", expected: "2026-06-09" },
  { input: "parīt", expected: "2026-06-10" },
  
  // Phrase matches using includes()
  { input: "rīt vakarā", expected: "2026-06-09" },
  { input: "rīt plkst. 18:00", expected: "2026-06-09" },
  { input: "rīt ap 19:00", expected: "2026-06-09" },
  { input: "parīt 20:00", expected: "2026-06-10" },
  { input: "šodien 18:00", expected: "2026-06-08" },

  // Latvian month names & grammatical forms
  { input: "4. augustā", expected: "2026-08-04" },
  { input: "15. jūlijā", expected: "2026-07-15" },
  { input: "2. septembrī", expected: "2026-09-02" },
  
  // Nearest future date logic
  { input: "4. aprīlī", expected: "2027-04-04" },
  { input: "7. jūnijā", expected: "2027-06-07" },
  { input: "8. jūnijā", expected: "2026-06-08" },
  
  // Numeric formats
  { input: "04.08", expected: "2026-08-04" },
  { input: "04.08.", expected: "2026-08-04" },
  { input: "04/08", expected: "2026-08-04" },
  { input: "2026-08-04", expected: "2026-08-04" }
];

const timeTests = [
  { input: "18:00", expected: "18:00" },
  { input: "18.00", expected: "18:00" },
  { input: "6pm", expected: "18:00" },
  { input: "18", expected: "18:00" }
];

console.log("Running date parser tests...");
let passed = true;
for (const test of dateTests) {
  try {
    const result = resolveLatvianDate(test.input, baseDate);
    assert.strictEqual(result, test.expected);
    console.log(`PASS: "${test.input}" -> "${result}"`);
  } catch (err) {
    console.error(`FAIL: resolveLatvianDate("${test.input}"): ${err.message}`);
    passed = false;
  }
}

console.log("\nRunning time parser tests...");
for (const test of timeTests) {
  try {
    const result = resolveTime(test.input);
    assert.strictEqual(result, test.expected);
    console.log(`PASS: "${test.input}" -> "${result}"`);
  } catch (err) {
    console.error(`FAIL: resolveTime("${test.input}"): ${err.message}`);
    passed = false;
  }
}

if (passed) {
  console.log("\nAll tests passed successfully!");
  process.exit(0);
} else {
  console.error("\nSome tests failed.");
  process.exit(1);
}
