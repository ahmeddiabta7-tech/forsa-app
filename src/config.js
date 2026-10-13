// Public settings for the Forsa app.
// The Supabase "anon" key is designed to be public; access is protected by Row Level Security in the database.
export const SUPABASE_URL = 'https://zkmbifplbpvwlvzbpnqc.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprbWJpZnBsYnB2d2x2emJwbnFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NzIyNjgsImV4cCI6MjEwNzI0ODI2OH0.9GeYb9aRI7CqRJ4E6PAw-AcIBhg-Mkn2TGoMqfzGU38';

// Where sellers send Make-your-own payments (deposit / rest). Replace with Forsa's real receiving details.
export const PAYMENT_INFO = {
  instapay: 'forsa@instapay',
  vodafone_cash: '010 0000 0000',
};

// Same numbers as the database (public.forsa_fee_pct, product_prices, check_unlock).
export const PLAN = {
  goalOrders: 3,     // pieces delivered to unlock profit
  unlockDays: 30,    // days unlocked after reaching the goal
  feePct: 10,        // Forsa fee: % of the seller's profit on ready products
  marketMinPct: 90,  // empty minimum price = 90% of the market price
};
