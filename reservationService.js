const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
} else {
  console.warn("[Supabase] WARNING: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are not configured.");
}

/**
 * Creates a new reservation if it doesn't already exist.
 * Avoids duplicate reservations based on phone number, date, and time.
 * 
 * @param {Object} reservationData
 * @param {string} reservationData.customer_name
 * @param {string} reservationData.phone_number
 * @param {number|string} reservationData.guests
 * @param {string} reservationData.reservation_date
 * @param {string} reservationData.reservation_time
 * @returns {Promise<{id: string, isNew: boolean, data: Object}>}
 */
async function createReservation(reservationData) {
  if (!supabase) {
    throw new Error("Supabase client is not initialized. Check your environment variables.");
  }

  const { customer_name, phone_number, guests, reservation_date, reservation_time } = reservationData;

  // 1. Check for duplicate reservation
  const { data: existing, error: findError } = await supabase
    .from("reservations")
    .select("id, customer_name, guests, status, created_at")
    .eq("phone_number", phone_number)
    .eq("reservation_date", reservation_date)
    .eq("reservation_time", reservation_time)
    .maybeSingle();

  if (findError) {
    console.error("[Supabase] Error checking for existing reservation:", findError);
    throw findError;
  }

  if (existing) {
    return {
      id: existing.id,
      isNew: false,
      data: existing
    };
  }

  // 2. Insert new reservation
  const { data: inserted, error: insertError } = await supabase
    .from("reservations")
    .insert([
      {
        customer_name,
        phone_number,
        guests: parseInt(guests, 10),
        reservation_date,
        reservation_time,
        status: "confirmed"
      }
    ])
    .select()
    .single();

  if (insertError) {
    console.error("[Supabase] Error inserting reservation:", insertError);
    throw insertError;
  }

  return {
    id: inserted.id,
    isNew: true,
    data: inserted
  };
}

async function findLatestActiveReservation(phone_number) {
  if (!supabase) {
    throw new Error("Supabase client is not initialized. Check your environment variables.");
  }
  const { data, error } = await supabase
    .from("reservations")
    .select("id, customer_name, phone_number, guests, reservation_date, reservation_time, status")
    .eq("phone_number", phone_number)
    .eq("status", "confirmed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[Supabase] Error finding active reservation:", error);
    throw error;
  }
  return data;
}

async function cancelReservation(reservationId) {
  if (!supabase) {
    throw new Error("Supabase client is not initialized. Check your environment variables.");
  }
  const { data, error } = await supabase
    .from("reservations")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", reservationId)
    .select()
    .single();

  if (error) {
    console.error("[Supabase] Error cancelling reservation:", error);
    throw error;
  }
  return data;
}

async function findReservationById(id) {
  if (!supabase) {
    throw new Error("Supabase client is not initialized. Check your environment variables.");
  }
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[Supabase] Error finding reservation by ID:", error);
    throw error;
  }
  return data;
}

module.exports = {
  createReservation,
  findLatestActiveReservation,
  cancelReservation,
  findReservationById,
  supabaseClient: supabase
};
