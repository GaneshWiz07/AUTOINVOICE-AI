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
// IMPORTANT: In production, use a persistent session store instead of MemoryStore.
// Examples: connect-pg-simple (for Supabase/Postgres), connect-redis, connect-mongo
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-very-strong-secret-key', // Replace with a strong secret from .env
  resave: false,
  saveUninitialized: false, // Set to true if you want to store sessions for unauthenticated users (e.g., for analytics)
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production (requires HTTPS)
    httpOnly: true, // Prevents client-side JS from accessing the cookie
    maxAge: 24 * 60 * 60 * 1000 // 24 hours, for example
  }
  // store: new MemoryStore(), // Default, can be explicit for clarity but not needed if default is fine for now
}));

app.use(cors({ 
  origin: process.env.FRONTEND_URL ? 
    [process.env.FRONTEND_URL, 'http://localhost:5173', 'https://autoinvoice-ai.pages.dev'] : 
    ['http://localhost:5173', 'https://autoinvoice-ai.pages.dev'],
  credentials: true // Important: Allow cookies to be sent from frontend
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
    res.status(500).send('Failed to initiate Google authentication. Check server logs and credentials.json. Error: ' + error.message);
  }
});

app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Authorization code missing.');
  }

  try {
    let oAuth2ClientForCallback = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    // The getTokensFromCode function from googleAuth.js likely needs to be adapted
    // or we directly use oAuth2ClientForCallback.getToken(code) here.
    // For now, assuming getTokensFromCode is a utility that might save to token.json,
    // we might need to adjust it or replicate its core token fetching logic here
    // to avoid saving globally and instead save to session.

    // Let's assume getTokensFromCode can be modified or we use the direct method:
    const { tokens } = await oAuth2ClientForCallback.getToken(code);
    oAuth2ClientForCallback.setCredentials(tokens); // Set credentials on this client instance

    // Store tokens in session
    // IMPORTANT: Ensure you request 'offline' access type in getAuthUrl 
    // if you want to receive a refresh_token. Refresh tokens are essential.
    req.session.googleTokens = tokens; 

    // Fetch user info with the authenticated client
    const oauth2 = google.oauth2({version: 'v2', auth: oAuth2ClientForCallback});
    const { data: googleUserProfile } = await oauth2.userinfo.get();
    
    // Store relevant user profile information in session
    req.session.user = {
        id: googleUserProfile.id, // Google's unique user ID
        email: googleUserProfile.email,
        name: googleUserProfile.name,
        picture: googleUserProfile.picture
        // Add other fields as needed
    };

    console.log(`User ${googleUserProfile.email} authenticated. Tokens and profile stored in session.`);
    
    // Manually save the session before redirecting, especially if a new session was created.
    req.session.save(err => {
      if (err) {
        console.error('Session save error before redirect:', err);
        return res.status(500).send('Error saving session before redirect.');
      }
      // Redirect to frontend, passing user email for display or a success flag
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth-success?email=${googleUserProfile.email}`);
    });

  } catch (error) {
    console.error('Error during Google OAuth callback:', error);
    // Clear potentially partially set session data on error
    req.session.destroy(err => {
        if (err) console.error('Error destroying session on auth failure:', err);
    });
    res.status(500).send('Error processing Google authentication: ' + error.message);
  }
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
  try {
    const userInfo = await getCurrentUserInfo(req);
    if (!userInfo || !userInfo.id) {
      console.warn('User not authenticated for /download-excel');
      return res.status(401).send('Authentication required. Please log in via Google.');
    }
    const userId = userInfo.id;
    const userEmail = userInfo.email || 'anonymous';
    console.log(`Generating Excel for user: ${userEmail} (ID: ${userId})`);

    const invoices = await getInvoicesForUser(userId);

    if (!invoices || invoices.length === 0) {
      return res.status(404).send('No invoices found for this user to download.');
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Autoinvoice AI';
    workbook.lastModifiedBy = 'Autoinvoice AI';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.lastPrinted = new Date();

    const worksheet = workbook.addWorksheet('Invoices');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 38 },
      { header: 'Invoice Number', key: 'invoice_number', width: 20 },
      { header: 'Vendor', key: 'vendor', width: 30 },
      { header: 'Amount', key: 'amount', width: 15, style: { numFmt: '$#,##0.00' } },
      { header: 'Invoice Date', key: 'invoice_date', width: 15, style: { numFmt: 'yyyy-mm-dd' } },
      { header: 'Due Date', key: 'due_date', width: 15, style: { numFmt: 'yyyy-mm-dd' } },
      { header: 'File Name', key: 'file_name', width: 40 },
      { header: 'File URL', key: 'file_url', width: 50 },
      { header: 'Created At', key: 'created_at', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm:ss' } },
    ];

    invoices.forEach(invoice => {
      worksheet.addRow({
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        vendor: invoice.vendor,
        amount: invoice.amount,
        invoice_date: invoice.invoice_date ? new Date(invoice.invoice_date) : null,
        due_date: invoice.due_date ? new Date(invoice.due_date) : null,
        file_name: invoice.file_name,
        file_url: invoice.file_url,
        created_at: invoice.created_at ? new Date(invoice.created_at) : null,
      });
    });

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    const headerFill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF203764' } // Blue background
    };

    worksheet.columns.forEach((column, index) => {
      headerRow.getCell(index + 1).fill = headerFill;
    });

    // Add borders to all cells
    const borderStyle = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } }
    };

    worksheet.eachRow({ includeEmpty: true }, function(row, rowNumber) {
      row.eachCell({ includeEmpty: true }, function(cell, colNumber) {
        cell.border = borderStyle;
      });
    });

    const filename = `invoices_${userEmail.split('@')[0]}_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Error generating Excel file:', error.message);
    res.status(500).send('Failed to generate Excel file: ' + error.message);
  }
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
  if (req.session && req.session.user) {
    res.status(200).json({ user: req.session.user });
  } else {
    // No active session or user data in session
    res.status(401).json({ message: 'Not authenticated' }); 
  }
});

// New endpoint for user logout
app.post('/api/logout', (req, res) => { // Using POST for logout is a good practice
  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session during logout:', err);
      return res.status(500).send({ message: 'Could not log out, please try again.' });
    }
    // Clear the session cookie from the browser.
    // The name 'connect.sid' is the default for express-session. If you configured a different name, use that.
    res.clearCookie('connect.sid'); 
    res.status(200).json({ message: 'Logged out successfully' });
  });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});