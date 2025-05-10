import { supabase } from './supabaseClient.js';
import { bufferToStream } from './gmailService.js'; // For converting buffer to stream for upload
import { v4 as uuidv4 } from 'uuid'; // For generating unique file names

const INVOICE_FILES_BUCKET = 'invoice-files'; // Match the bucket name in your Supabase Storage

/**
 * Uploads a file to Supabase Storage.
 * @param {Buffer} fileBuffer - The file content as a Buffer.
 * @param {string} originalFilename - The original name of the file.
 * @param {string} mimeType - The MIME type of the file.
 * @param {string} userId - The ID of the user uploading the file (for namespacing in storage).
 * @returns {Promise<string|null>} The public URL of the uploaded file or null on error.
 */
export async function uploadFileToSupabase(fileBuffer, originalFilename, mimeType, userId) {
  if (!supabase) {
    console.error('Supabase client not initialized. Cannot upload file.');
    return null;
  }
  if (!userId) {
    console.error('User ID is required to upload file to Supabase.');
    return null;
  }

  // Create a unique path for the file to avoid name collisions and organize by user
  const fileExtension = originalFilename.split('.').pop();
  const uniqueFilename = `${uuidv4()}.${fileExtension}`;
  const filePath = `${userId}/${uniqueFilename}`;

  try {
    const { data, error } = await supabase.storage
      .from(INVOICE_FILES_BUCKET)
      .upload(filePath, fileBuffer, {
        contentType: mimeType,
        upsert: false, 
      });

    if (error) {
      console.error('Error uploading file to Supabase Storage:', error);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from(INVOICE_FILES_BUCKET)
      .getPublicUrl(filePath);

    if (!publicUrlData || !publicUrlData.publicUrl) {
        console.error('Could not get public URL for uploaded file:', filePath);
        return null; 
    }
    
    console.log(`File uploaded successfully to Supabase Storage: ${publicUrlData.publicUrl}`);
    return publicUrlData.publicUrl;
  } catch (err) {
    console.error('Exception during file upload to Supabase:', err);
    return null;
  }
}

/**
 * Saves extracted invoice data to the Supabase database.
 * @param {object} invoiceData - The structured invoice data.
 * @returns {Promise<object|null>} The saved invoice record or null on error.
 */
export async function saveInvoiceData(invoiceData) {
  if (!supabase) {
    console.error('Supabase client not initialized. Cannot save invoice data.');
    return null;
  }
  if (!invoiceData.user_id) {
    console.error('User ID is required to save invoice data.');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('invoices') 
      .insert([invoiceData])
      .select(); 

    if (error) {
      console.error('Error saving invoice data to Supabase:', error);
      return null;
    }

    console.log('Invoice data saved successfully to Supabase:', data);
    return data && data.length > 0 ? data[0] : null;
  } catch (err) {
    console.error('Exception during invoice data saving to Supabase:', err);
    return null;
  }
}

/**
 * Fetches all invoices for a given user from the Supabase database.
 * @param {string} userId - The ID of the user whose invoices to fetch.
 * @returns {Promise<Array<object>|null>} An array of invoice records or null on error.
 */
export async function getInvoicesForUser(userId) {
  if (!supabase) {
    console.error('Supabase client not initialized. Cannot fetch invoices.');
    return null;
  }
  if (!userId) {
    console.error('User ID is required to fetch invoices.');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('invoices')
      .select('*') 
      .eq('user_id', userId)
      .order('created_at', { ascending: false }); 

    if (error) {
      console.error('Error fetching invoices from Supabase:', error);
      return null;
    }
    return data || [];
  } catch (err) {
    console.error('Exception during fetching invoices from Supabase:', err);
    return null;
  }
}

/**
 * Fetches a single invoice by its ID for a given user.
 * @param {string} invoiceId - The UUID of the invoice to fetch.
 * @param {string} userId - The ID of the user who owns the invoice.
 * @returns {Promise<object|null>} The invoice record or null if not found or on error.
 */
export async function getInvoiceById(invoiceId, userId) {
  if (!supabase) {
    console.error('Supabase client not initialized. Cannot fetch invoice.');
    return null;
  }
  if (!invoiceId || !userId) {
    console.error('Invoice ID and User ID are required to fetch an invoice.');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('user_id', userId)
      .single(); // Expect a single record or null

    if (error) {
      if (error.code === 'PGRST116') { // PostgREST error code for "Fetched result not found"
        console.log(`Invoice not found with ID: ${invoiceId} for user: ${userId}`);
        return null;
      }
      console.error(`Error fetching invoice by ID (${invoiceId}):`, error);
      return null;
    }
    return data;
  } catch (err) {
    console.error(`Exception fetching invoice by ID (${invoiceId}):`, err);
    return null;
  }
}

/**
 * Updates an existing invoice in the Supabase database.
 * @param {string} invoiceId - The UUID of the invoice to update.
 * @param {string} userId - The ID of the user who owns the invoice.
 * @param {object} invoiceUpdateData - An object containing the fields to update.
 * @returns {Promise<object|null>} The updated invoice record or null on error.
 */
export async function updateInvoice(invoiceId, userId, invoiceUpdateData) {
  if (!supabase) {
    console.error('Supabase client not initialized. Cannot update invoice.');
    return null;
  }
  if (!invoiceId || !userId || !invoiceUpdateData) {
    console.error('Invoice ID, User ID, and update data are required to update an invoice.');
    return null;
  }

  // Ensure user_id is not part of the update data to prevent changing ownership
  // and ensure message_id is not changed if it's part of the unique key logic
  const { user_id, message_id, id, created_at, updated_at, extracted_data, ...allowedUpdates } = invoiceUpdateData;

  try {
    const { data, error } = await supabase
      .from('invoices')
      .update(allowedUpdates)
      .eq('id', invoiceId)
      .eq('user_id', userId) // Crucial: ensure user can only update their own invoices
      .select();

    if (error) {
      console.error(`Error updating invoice (${invoiceId}):`, error);
      return null;
    }
    if (!data || data.length === 0) {
        console.warn(`Invoice not found or user mismatch during update for ID: ${invoiceId}`);
        return null; // Or throw an error indicating not found/not authorized
    }
    console.log(`Invoice updated successfully:`, data[0]);
    return data[0];
  } catch (err) {
    console.error(`Exception during invoice update (${invoiceId}):`, err);
    return null;
  }
}

/**
 * Deletes an invoice from the Supabase database.
 * @param {string} invoiceId - The UUID of the invoice to delete.
 * @param {string} userId - The ID of the user who owns the invoice.
 * @returns {Promise<boolean>} True if deletion was successful, false otherwise.
 */
export async function deleteInvoice(invoiceId, userId) {
  if (!supabase) {
    console.error('Supabase client not initialized. Cannot delete invoice.');
    return false;
  }
  if (!invoiceId || !userId) {
    console.error('Invoice ID and User ID are required to delete an invoice.');
    return false;
  }

  try {
    // First, verify the invoice exists and belongs to the user (optional, but good practice)
    // Alternatively, rely on the .eq('user_id', userId) in the delete query itself.
    const { error: deleteError } = await supabase
      .from('invoices')
      .delete()
      .eq('id', invoiceId)
      .eq('user_id', userId); // Crucial: ensure user can only delete their own invoices

    if (deleteError) {
      console.error(`Error deleting invoice (${invoiceId}):`, deleteError);
      return false;
    }
    
    // Supabase delete doesn't return the deleted record by default in the same way select/update does with .select().
    // A successful delete operation with RLS ensuring user_id match is sufficient.
    // If you needed to check if a row was actually deleted (e.g. not found), you'd query first.
    console.log(`Invoice with ID: ${invoiceId} marked for deletion (or did not exist for user).`);
    return true; // Assuming success if no error, as RLS handles user ownership.
  } catch (err) {
    console.error(`Exception during invoice deletion (${invoiceId}):`, err);
    return false;
  }
}
 