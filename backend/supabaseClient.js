import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
// Use the Service Role Key for backend operations - bypasses RLS
// Ensure this key is kept secure and never exposed to the frontend
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Supabase URL or Service Role Key is missing. Please check your .env file.');
}

// Initialize client with the Service Role Key for backend use
export const supabase = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

if (!supabase) {
    console.warn('Supabase client could not be initialized. Backend operations requiring Supabase will fail.');
} 