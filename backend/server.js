import express from 'express';
import session from 'express-session';
import cors from 'cors';
import dotenv from 'dotenv';
import { supabase } from './supabaseClient.js';
import { getOAuthClient, getAuthUrl, google } from './googleAuth.js';
import { fetchInvoiceAttachments } from './gmailService.js';
import { uploadFileToSupabase, saveInvoiceData, getInvoicesForUser, getInvoiceById, updateInvoice, deleteInvoice } from './supabaseService.js';
import { extractInvoiceDataWithOpenRouter } from './openRouterService.js';
import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';

dotenv.config();

// Check Supabase connection right after config is loaded and client is imported
if (supabase) {
  console.log('Supabase client initialized successfully.');
} else {
  console.error('CRITICAL: Supabase client failed to initialize. Check .env and Supabase project status. Backend operations requiring Supabase will fail.');
  // Optionally, exit if Supabase is absolutely critical for startup
  // process.exit(1);
}

const app = express();
const port = process.env.PORT || 3001;

// Session Configuration
app.use(session({
  secret: 'autoinvoice-ai-default-secret', // Keep this or use a strong env var
  resave: false,
  saveUninitialized: true, // Keeps session created even if not modified, can be useful
  cookie: {
    secure: process.env.NODE_ENV === 'production', // TRUE in production (like Render), false in dev
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    // For cross-domain cookies to work with HTTPS, SameSite='None' is needed.
    // 'lax' is more secure if frontend and backend are on the same site (e.g. subdomains of the same eTLD+1)
    // On Render, your frontend and backend might be on different subdomains of onrender.com or custom domains.
    // Using 'None' with 'secure: true' is a common setup for this.
    sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'lax'
  }
  // IMPORTANT FOR PRODUCTION ON RENDER:
  // The default MemoryStore is not suitable for production as it will leak memory
  // and won't work across multiple instances or if your app restarts.
  // Consider using a persistent store like connect-redis, connect-mongo, or connect-pg-simple.
  // Example with connect-redis (you'd need to npm install redis connect-redis):
  // store: new RedisStore({ client: redisClient, prefix: "autoinvoice_sess:" }),
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173', // CRITICAL: Ensure FRONTEND_URL is correct in Render
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Helper function to get user info using the current auth state
// MODIFIED: This will now primarily use session data
async function getCurrentUserInfo(req) { // Pass req to access session
  if (req.session && req.session.user) {
    return req.session.user; // Return user info stored in session
  }
  // If no session user, try to fall back to old method (though this should be phased out for multi-user)
  // For multi-user, if !req.session.user, they are not logged in via session.
  console.warn('getCurrentUserInfo called without a user in session.');
  return null; 
}

// Helper function to get a Gmail client using session tokens
async function getGmailClient(req) {
  const oAuth2Client = await getSessionAuthenticatedClient(req);
  if (!oAuth2Client) {
    throw new Error('Authentication required. No valid Google tokens found in session.');
  }
  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

// Helper function to get an authenticated OAuth2 client for the current session user
// NEW: This creates a client from session tokens
async function getSessionAuthenticatedClient(req) {
  if (!req.session || !req.session.googleTokens) {
    console.warn('No Google tokens found in session.');
    return null;
  }

  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oAuth2Client.setCredentials(req.session.googleTokens);

  // Handle token refresh if necessary (googleapis library often handles this automatically if refresh_token is present)
  // You can add an event listener for 'tokens' to update the session if they are refreshed.
  oAuth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      // persist the new refresh token if you got one
      console.log('Received new refresh token during auto-refresh.');
      req.session.googleTokens.refresh_token = tokens.refresh_token;
    }
    console.log('Access token was refreshed. Updating session tokens.');
    // Update other token parts that might have changed (access_token, expiry_date)
    req.session.googleTokens.access_token = tokens.access_token;
    req.session.googleTokens.expiry_date = tokens.expiry_date;
    req.session.googleTokens.scope = tokens.scope;
    req.session.googleTokens.token_type = tokens.token_type;
    // Manually save session if your store requires it after modifications like this, though express-session usually handles it.
    req.session.save(err => {
        if(err) console.error('Session save error after token refresh:', err);
    });
  });

  return oAuth2Client;
}

app.get('/', (req, res) => {
  res.send('Autoinvoice AI Backend is running!');
});

app.get('/auth/google', async (req, res) => {
  try {
    // We still need an initial client instance to generate the URL
    const oAuth2ClientForUrl = await getOAuthClient(); 
    const authUrl = getAuthUrl(oAuth2ClientForUrl);
    res.redirect(authUrl);
  } catch (error) { 
    console.error('Failed to start Google OAuth flow:', error);
    res.status(500).send('Failed to initiate Google authentication. Check server logs and OAuth environment variables. Error: ' + error.message);
  }
});

app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  console.log('Google callback received with code:', code ? 'Yes' : 'No');
  if (!code) {
    return res.status(400).send('Authorization code missing.');
  }

  try {
    let oAuth2ClientForCallback = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    
    console.log('Exchanging code for tokens...');
    const { tokens } = await oAuth2ClientForCallback.getToken(code);
    oAuth2ClientForCallback.setCredentials(tokens);
    console.log('Tokens obtained:', tokens ? 'Yes (details below)' : 'No');
    if(tokens) console.log('Token details (partial):', { access_token_exists: !!tokens.access_token, refresh_token_exists: !!tokens.refresh_token, expiry_date: tokens.expiry_date });

    const oauth2 = google.oauth2({version: 'v2', auth: oAuth2ClientForCallback});
    const { data: googleUserProfile } = await oauth2.userinfo.get();
    console.log('Google user profile fetched:', googleUserProfile ? googleUserProfile.email : 'Error/No profile');

    const userData = {
      id: googleUserProfile.id,
      email: googleUserProfile.email,
      name: googleUserProfile.name,
      picture: googleUserProfile.picture
    };

    // Create a temporary auth token
    const tempAuthToken = uuidv4();
    if (!global.tempAuthTokens) {
      global.tempAuthTokens = new Map();
    }
    global.tempAuthTokens.set(tempAuthToken, {
      userData: userData,
      googleTokens: tokens,
      expires: Date.now() + (5 * 60 * 1000) // 5 minutes
    });
    console.log(`Temp auth token ${tempAuthToken.substring(0,8)}... created for user ${userData.email}`);

    setTimeout(() => {
      if (global.tempAuthTokens && global.tempAuthTokens.has(tempAuthToken)) {
        global.tempAuthTokens.delete(tempAuthToken);
        console.log(`Temp auth token ${tempAuthToken.substring(0,8)}... expired and deleted.`);
      }
    }, 5 * 60 * 1000);

    // Redirect with token
    const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth-success?token=${tempAuthToken}`;
    console.log('Redirecting to frontend with token:', redirectUrl);
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('Error during Google OAuth callback:', error.response ? error.response.data : error.message, error.stack);
    // Do NOT destroy session here as it might not exist or be fully set up.
    res.status(500).send('Error processing Google authentication: ' + error.message);
  }
});

app.get('/api/exchange-token', (req, res) => {
  const { token } = req.query;
  console.log('Exchange token request received. Token provided:', token ? 'Yes' : 'No');

  if (!token) {
    console.warn('Exchange token attempt with no token.');
    return res.status(400).json({ success: false, message: 'Token missing.' });
  }

  if (!global.tempAuthTokens || !global.tempAuthTokens.has(token)) {
    console.warn(`Exchange token attempt with invalid/expired/unknown token: ${token.substring(0,8)}...`);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  const tokenData = global.tempAuthTokens.get(token);
  console.log(`Found temp token data for ${token.substring(0,8)}... User: ${tokenData.userData.email}`);

  if (tokenData.expires < Date.now()) {
    console.warn(`Exchange token attempt with expired token (server-side check): ${token.substring(0,8)}...`);
    global.tempAuthTokens.delete(token); // Clean up expired token
    return res.status(401).json({ success: false, message: 'Token expired' });
  }

  // Set up the user's session
  req.session.user = tokenData.userData;
  req.session.googleTokens = tokenData.googleTokens;
  console.log(`Session data being set for user: ${req.session.user.email}. Session ID: ${req.sessionID}`);
  
  global.tempAuthTokens.delete(token); // Remove the temporary token after use
  console.log(`Temp token ${token.substring(0,8)}... deleted after successful exchange.`);

  req.session.save(err => {
    if (err) {
      console.error('Session save error during token exchange:', err);
      return res.status(500).json({ success: false, message: 'Error saving session' });
    }
    console.log(`Session saved successfully for user: ${req.session.user.email}. Cookie being sent (check browser).`);
    res.status(200).json({
      success: true,
      message: 'Authentication successful',
      user: tokenData.userData
    });
  });
});

app.get('/test-gmail', async (req, res) => {
  try {
    const gmail = await getGmailClient(req);
    const response = await gmail.users.labels.list({
      userId: 'me',
    });
    res.json(response.data.labels || []);
  } catch (error) {
    console.error('Error accessing Gmail API:', error.message);
    if (error.message.includes('No refresh token is set.') || error.message.includes('invalid_grant') || error.message.includes('No saved credentials')) {
        res.status(401).send('Authentication required or token expired. Please authenticate via /auth/google.');
    } else {
        res.status(500).send(`Failed to access Gmail API: ${error.message}`);
    }
  }
});

// Route to fetch and process invoice attachments from Gmail
app.get('/process-emails', async (req, res) => {
  try {
    const userInfo = await getCurrentUserInfo(req);
    if (!userInfo || !userInfo.id) {
      console.warn('User not authenticated for /process-emails');
      return res.status(401).send('Authentication required. Please log in via Google.');
    }
    const userId = userInfo.id;
    const userEmail = userInfo.email;
    console.log(`Processing emails for user: ${userEmail} (ID: ${userId})`);

    const gmailClient = await getGmailClient(req);
    const attachments = await fetchInvoiceAttachments(gmailClient, userInfo.email); // Pass user email for logging/context

    if (!attachments || attachments.length === 0) {
      return res.status(200).json({ message: 'No new invoices found or processed.', processedInvoices: [] });
    }

    const processedInvoices = [];
    for (const attachment of attachments) {
      try {
        // Check if messageId is present (essential for uniqueness check)
        if (!attachment.messageId) {
            console.warn(`Skipping attachment ${attachment.filename} because messageId is missing.`);
            processedInvoices.push({ filename: attachment.filename, status: 'Skipped', reason: 'Missing messageId' });
            continue;
        }

        // OPTIMIZATION: Check if this message has already been processed for this user BEFORE storage/LLM call
        console.log(`Checking for existing invoice (messageId: ${attachment.messageId}, userId: ${userId}) before processing...`);
        const { data: existingInvoices, error: checkError } = await supabase
          .from('invoices')
          .select('id') // Only need to check for existence
          .eq('user_id', userId)
          .eq('message_id', attachment.messageId)
          .limit(1);

        if (checkError) {
            console.error(`Error checking for existing invoice (messageId: ${attachment.messageId}):`, checkError.message);
            // Decide whether to skip or proceed despite the check error. For now, log and skip.
            processedInvoices.push({ filename: attachment.filename, status: 'Error', reason: `Supabase check failed: ${checkError.message}` });
            continue; 
        }

        if (existingInvoices && existingInvoices.length > 0) {
            console.log(`Skipping already processed invoice from messageId: ${attachment.messageId} (found existing record ID: ${existingInvoices[0].id})`);
            processedInvoices.push({ filename: attachment.filename, status: 'Skipped', reason: 'Already processed and in database' });
            continue;
        }
        console.log(`Invoice from messageId: ${attachment.messageId} is new. Proceeding with processing.`);

        // Log attachment structure (can be removed later)
        // console.log('Inspecting attachment in server.js before processing:', JSON.stringify(attachment).substring(0, 500));

        // 1. Upload to Supabase Storage (Only if new)
        const fileUrl = await uploadFileToSupabase(attachment.data, attachment.filename, attachment.mimeType, userInfo.id);

        if (!fileUrl) {
          console.error(`Failed to upload ${attachment.filename} to Supabase.`);
          // Decide if you want to skip this file or stop the whole process
          continue; // Skip this file
        }

        console.log(`Successfully uploaded ${attachment.filename} to Supabase.`);

        // Call OpenRouter service for data extraction
        console.log(`Attempting LLM extraction for ${attachment.filename} (MIME: ${attachment.mimeType})...`);
        const extractionResult = await extractInvoiceDataWithOpenRouter(attachment.data, attachment.mimeType);

        let invoiceRecord;

        if (extractionResult && !extractionResult.error && extractionResult.status !== 'unsupported_format') {
            console.log(`Successfully extracted data for ${attachment.filename} using LLM.`);
            // Map extracted data to Supabase table columns
            invoiceRecord = {
                user_id: userInfo.id,
                message_id: attachment.messageId,
                invoice_number: extractionResult.invoice_number || null,
                amount: extractionResult.total_amount || null, // LLM is prompted for total_amount
                vendor: extractionResult.vendor_name || 'Unknown Vendor', // LLM is prompted for vendor_name
                invoice_date: extractionResult.invoice_date || null,
                due_date: extractionResult.due_date || null,
                description: `Invoice data extracted by LLM (${extractionResult.llm_model || DEFAULT_MODEL}).`,
                file_name: attachment.filename,
                file_url: fileUrl,
                extracted_data: extractionResult, // Store the full LLM response (or parsed part)
                status: 'approved', // Default status for successfully processed invoices
            };
        } else {
            // Handle errors or unsupported formats from the extraction service
            const reason = extractionResult ? (extractionResult.message || extractionResult.error || 'Unknown extraction issue') : 'No result from extraction service';
            console.warn(`LLM extraction skipped or failed for ${attachment.filename}: ${reason}`);
            invoiceRecord = {
                user_id: userInfo.id,
                message_id: attachment.messageId,
                invoice_number: null,
                amount: null,
                vendor: 'Extraction Incomplete/Failed',
                invoice_date: null,
                due_date: null,
                description: `LLM extraction failed or not applicable for ${attachment.filename}: ${reason}`,
                file_name: attachment.filename,
                file_url: fileUrl,
                extracted_data: extractionResult || { status: 'extraction_failed', reason: reason },
                status: 'approved', // Default status even for incompletely processed invoices
            };
        }
        
        await saveInvoiceData(invoiceRecord);
        processedInvoices.push({ filename: attachment.filename, status: 'Processed', url: fileUrl, data: invoiceRecord });

      } catch (error) {
        console.error(`Error processing attachment ${attachment.filename}:`, error);
        // Optionally log error to Supabase or a logging service
         processedInvoices.push({ filename: attachment.filename, status: 'Error', error: error.message });
      }
    }

    res.status(200).json({
      message: `Processed ${attachments.length} attachments.`,
      count: attachments.length,
      results: processedInvoices
    });

  } catch (error) {
    console.error('Error in /process-emails route:', error.message);
    if (error.message.includes('Authentication required') || error.message.includes('token') || error.message.includes('No saved credentials') || error.message.includes('invalid_grant')) {
      res.status(401).send('Authentication error or invalid token. Please log in again via /auth/google. Details: ' + error.message);
    } else {
      res.status(500).send('Failed to process emails: ' + error.message);
    }
  }
});

// Route to get invoices for the current user
app.get('/invoices', async (req, res) => {
  try {
    const userInfo = await getCurrentUserInfo(req);
    if (!userInfo || !userInfo.id) {
      console.warn('User not authenticated for /invoices');
      return res.status(401).send('Authentication required. Please log in via Google.');
    }
    const userId = userInfo.id;
    console.log(`Fetching invoices for user ID: ${userId}`);

    const invoices = await getInvoicesForUser(userId);
    if (invoices === null) {
      return res.status(500).send('Error fetching invoices from Supabase.');
    }
    res.status(200).json(invoices);
  } catch (error) {
    console.error('Error in /invoices route:', error.message);
    // Check for specific auth-related errors that might indicate an expired/invalid token
    if (error.message.includes('Authentication required') || error.message.includes('token') || error.message.includes('No saved credentials') || error.message.includes('invalid_grant')) {
      res.status(401).send('Authentication error or invalid token. Please log in again via /auth/google. Details: ' + error.message);
    } else {
      res.status(500).send('Failed to fetch invoices: ' + error.message);
    }
  }
});

// GET a single invoice by ID
app.get('/api/invoices/:id', async (req, res) => {
  try {
    const userInfo = await getCurrentUserInfo(req);
    if (!userInfo || !userInfo.id) {
      return res.status(401).send('Authentication required.');
    }
    const userId = userInfo.id;
    const { id: invoiceId } = req.params;

    const invoice = await getInvoiceById(invoiceId, userId);

    if (!invoice) {
      return res.status(404).send('Invoice not found or access denied.');
    }
    res.status(200).json(invoice);
  } catch (error) {
    console.error(`Error in /api/invoices/:id GET route (ID: ${req.params.id}):`, error.message);
    res.status(500).send('Failed to retrieve invoice: ' + error.message);
  }
});

// PUT (Update) an existing invoice
app.put('/api/invoices/:id', async (req, res) => {
  try {
    const userInfo = await getCurrentUserInfo(req);
    if (!userInfo || !userInfo.id) {
      return res.status(401).send('Authentication required.');
    }
    const userId = userInfo.id;
    const { id: invoiceId } = req.params;
    const updateData = req.body;

    // Basic validation: ensure there's something to update
    if (Object.keys(updateData).length === 0) {
        return res.status(400).send('No update data provided.');
    }

    const updatedInvoice = await updateInvoice(invoiceId, userId, updateData);

    if (!updatedInvoice) {
      return res.status(404).send('Invoice not found, update failed, or access denied.');
    }
    res.status(200).json(updatedInvoice);
  } catch (error) {
    console.error(`Error in /api/invoices/:id PUT route (ID: ${req.params.id}):`, error.message);
    res.status(500).send('Failed to update invoice: ' + error.message);
  }
});

// DELETE an invoice
app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const userInfo = await getCurrentUserInfo(req);
    if (!userInfo || !userInfo.id) {
      return res.status(401).send('Authentication required.');
    }
    const userId = userInfo.id;
    const { id: invoiceId } = req.params;

    const success = await deleteInvoice(invoiceId, userId);

    if (!success) {
      // This could be due to not found, or an actual delete error, or RLS preventing.
      // The service function logs details.
      return res.status(404).send('Invoice not found or delete failed/denied.');
    }
    res.status(204).send(); // 204 No Content for successful deletion
  } catch (error) {
    console.error(`Error in /api/invoices/:id DELETE route (ID: ${req.params.id}):`, error.message);
    res.status(500).send('Failed to delete invoice: ' + error.message);
  }
});

// Route to download invoices as an Excel file
app.get('/download-excel', async (req, res) => {
  // ... existing code ...
});

// New endpoint to update invoice status
app.put('/api/invoices/:id/status', async (req, res) => {
  try {
    const userInfo = await getCurrentUserInfo(req);
    if (!userInfo || !userInfo.id) {
      console.warn('User not authenticated for updating invoice status');
      return res.status(401).send('Authentication required.');
    }
    const userId = userInfo.id;
    const { id: invoiceId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).send('Status is required in the request body.');
    }

    // Optional: Add validation for allowed status values if needed
    // const allowedStatuses = ['pending', 'paid', 'overdue', 'draft'];
    // if (!allowedStatuses.includes(status)) {
    //   return res.status(400).send(`Invalid status value. Allowed values are: ${allowedStatuses.join(', ')}`);
    // }

    console.log(`Updating status for invoice ID: ${invoiceId} to "${status}" for user ID: ${userId}`);

    // We need to ensure that the user owns this invoice before updating.
    // First, fetch the invoice to check ownership.
    const existingInvoice = await getInvoiceById(invoiceId, userId);

    if (!existingInvoice) {
      return res.status(404).send('Invoice not found.');
    }

    if (existingInvoice.user_id !== userId) {
      console.warn(`User ${userId} attempt to update status of invoice ${invoiceId} owned by ${existingInvoice.user_id}`);
      return res.status(403).send('Forbidden. You do not own this invoice.');
    }

    // Update the invoice with the new status
    // The updateInvoice function should be capable of partial updates.
    const updatedInvoice = await updateInvoice(invoiceId, userId, { status });

    if (!updatedInvoice) {
      // updateInvoice might return null or throw an error if update fails
      return res.status(500).send('Failed to update invoice status.');
    }

    res.status(200).json({ message: 'Invoice status updated successfully.', invoice: updatedInvoice });

  } catch (error) {
    console.error(`Error updating invoice status for ID ${req.params.id}:`, error);
    if (error.message.includes('Authentication required') || error.message.includes('token') || error.message.includes('invalid_grant')) {
        res.status(401).send('Authentication error. Please log in again.');
    } else {
        res.status(500).send('Server error while updating invoice status: ' + error.message);
    }
  }
});

// New endpoint to get current user info from session
app.get('/api/me', (req, res) => {
  console.log(`/api/me called. Session ID: ${req.sessionID}. User in session:`, req.session.user ? req.session.user.email : 'No user');
  if (req.session && req.session.user) {
    res.status(200).json({ user: req.session.user });
  } else {
    res.status(401).json({ message: 'Not authenticated' }); 
  }
});

// Debug endpoint to check session status
app.get('/api/session-check', (req, res) => {
  console.log('Session check requested');
  const sessionData = {
    hasSession: !!req.session,
    sessionID: req.sessionID || null,
    hasUser: !!(req.session && req.session.user),
    userEmail: req.session && req.session.user ? req.session.user.email : null,
    cookies: req.headers.cookie || null
  };
  
  console.log('Session status:', sessionData);
  res.status(200).json(sessionData);
});

// New endpoint for user logout
app.post('/api/logout', (req, res) => { // Using POST for logout is a good practice
  const userEmail = req.session.user ? req.session.user.email : 'Unknown user';
  console.log(`Logout attempt for user: ${userEmail}. Session ID: ${req.sessionID}`);
  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session during logout:', err);
      return res.status(500).send({ message: 'Could not log out, please try again.' });
    }
    // The name 'connect.sid' is the default for express-session.
    res.clearCookie('connect.sid'); // Ensure this matches your session cookie name if customized
    console.log(`Session destroyed for ${userEmail}. Cookie cleared.`);
    res.status(200).json({ message: 'Logged out successfully' });
  });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}. NODE_ENV: ${process.env.NODE_ENV}`);
  if (process.env.NODE_ENV === 'production') {
    console.log('Production mode: Cookie settings: secure=true, sameSite="None"');
    console.log(`CORS origin configured for: ${process.env.FRONTEND_URL}`);
  } else {
    console.log('Development mode: Cookie settings: secure=false, sameSite="lax"');
  }
});

// Export the app for potential use by serverless wrappers if needed, or for testing.
export default app;