// Public settings for the Forsa app.
// The Supabase "anon" key is designed to be public; access is protected by Row Level Security in the database.
export const SUPABASE_URL = 'https://zkmbifplbpvwlvzbpnqc.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprbWJpZnBsYnB2d2x2emJwbnFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NzIyNjgsImV4cCI6MjEwNzI0ODI2OH0.9GeYb9aRI7CqRJ4E6PAw-AcIBhg-Mkn2TGoMqfzGU38';

// Where sellers send the EGP 100 subscription. Replace with Forsa's real receiving details.
export const PAYMENT_INFO = {
  instapay: 'forsa@instapay',
  vodafone_cash: '010 0000 0000',
};

export const PLAN = {
  trialDays: 30,
  goalOrders: 3,
  monthlyFee: 100,
};
