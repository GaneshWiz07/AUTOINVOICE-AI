import { google } from 'googleapis';
// import { getGmailClient } from './googleAuth.js'; // Removed problematic import
import stream from 'stream';
import { Buffer } from 'buffer';

const DEFAULT_MAX_EMAILS = 10; // Renamed and kept as default

/**
 * Lists recent emails matching the query.
 * @param {google.auth.OAuth2} gmailClient - Authenticated Gmail client.
 * @param {string} query - Gmail search query (e.g., 'subject:invoice has:attachment').
 * @param {number} maxResults - The maximum number of emails to return.
 * @returns {Promise<Array<object>>} A list of message objects.
 */
export async function listEmails(gmailClient, query = 'subject:invoice has:attachment', maxResults = DEFAULT_MAX_EMAILS) {
  // const gmail = await getGmailClient(); // Old way
  try {
    const res = await gmailClient.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: maxResults, // Use the parameter here
    });
    const messages = res.data.messages || [];
    if (messages.length === 0) {
      console.log('No messages found matching query:', query);
      return [];
    }
    console.log(`Found ${messages.length} emails matching query.`);
    return messages; // Returns array of { id: string, threadId: string }
  } catch (err) {
    console.error('The API returned an error while listing emails:', err);
    throw new Error('Failed to list emails from Gmail.');
  }
}

/**
 * Gets the details of a specific email, including attachments.
 * @param {google.auth.OAuth2} gmailClient - Authenticated Gmail client.
 * @param {string} messageId - The ID of the email message.
 * @returns {Promise<object|null>} Email details including parts and attachments.
 */
export async function getEmailDetails(gmailClient, messageId) {
  // const gmail = await getGmailClient(); // Old way
  try {
    const res = await gmailClient.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full', // We need full format to get payload details
    });
    return res.data;
  } catch (err) {
    console.error(`The API returned an error while getting email details for ${messageId}:`, err);
    throw new Error('Failed to get email details.');
  }
}

/**
 * Downloads a specific attachment from an email.
 * @param {google.auth.OAuth2} gmailClient - Authenticated Gmail client.
 * @param {string} messageId - The ID of the email message.
 * @param {string} attachmentId - The ID of the attachment.
 * @returns {Promise<{filename: string, mimeType: string, data: Buffer, size: number}>} Attachment data.
 */
export async function downloadAttachment(gmailClient, messageId, attachmentId) {
  // const gmail = await getGmailClient(); // Old way
  try {
    const res = await gmailClient.users.messages.attachments.get({
      userId: 'me',
      messageId: messageId,
      id: attachmentId,
    });
    // The data is base64 encoded, decode it
    const fileData = Buffer.from(res.data.data, 'base64');
    return {
      data: fileData,
      size: res.data.size,
    };
  } catch (err) {
    console.error(`The API returned an error while downloading attachment ${attachmentId} from message ${messageId}:`, err);
    throw new Error('Failed to download attachment.');
  }
}

/**
 * Processes emails to find and return attachment data for supported file types (PDF, images).
 * @param {google.auth.OAuth2} gmailClient - Authenticated Gmail client (passed from server.js).
 * @param {string} userEmailForLog - User's email for logging purposes.
 * @returns {Promise<Array<{filename: string, mimeType: string, data: Buffer, messageId: string, emailSubject: string, emailDate: string}>>}
 */
export async function fetchInvoiceAttachments(gmailClient, userEmailForLog) { // userEmailForLog is already passed
  // Fetch only the latest email by setting maxResults to 1
  const invoiceEmails = await listEmails(gmailClient, 'subject:invoice has:attachment newer_than:30d', 1);
  if (!invoiceEmails || invoiceEmails.length === 0) {
    return [];
  }

  const attachmentsData = [];

  for (const emailHeader of invoiceEmails) {
    const emailDetails = await getEmailDetails(gmailClient, emailHeader.id);
    if (!emailDetails || !emailDetails.payload) continue;

    const subjectHeader = emailDetails.payload.headers.find(h => h.name.toLowerCase() === 'subject');
    const dateHeader = emailDetails.payload.headers.find(h => h.name.toLowerCase() === 'date');
    const emailSubject = subjectHeader ? subjectHeader.value : 'No Subject';
    const emailDate = dateHeader ? new Date(dateHeader.value).toISOString() : new Date().toISOString();


    const parts = emailDetails.payload.parts || [];
    for (const part of parts) {
      if (part.filename && part.body && part.body.attachmentId) {
        // Check for PDF or common image types
        const supportedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif'];
        if (supportedMimeTypes.includes(part.mimeType.toLowerCase())) {
          console.log(`Found attachment: ${part.filename} (MIME: ${part.mimeType}) in email ID: ${emailHeader.id}`);
          try {
            const attachment = await downloadAttachment(gmailClient, emailHeader.id, part.body.attachmentId);
            attachmentsData.push({
              filename: part.filename,
              mimeType: part.mimeType,
              data: attachment.data,
              size: attachment.size,
              messageId: emailHeader.id,
              emailSubject,
              emailDate,
            });
          } catch (error) {
            console.error(`Failed to download attachment ${part.filename} from email ${emailHeader.id}:`, error);
            // Continue to next attachment/email
          }
        }
      }
    }
  }
  console.log(`Fetched ${attachmentsData.length} invoice attachments.`);
  return attachmentsData;
}

/**
 * Converts a Buffer to a Readable stream.
 * @param {Buffer} buffer - The buffer to convert.
 * @returns {stream.Readable} A readable stream.
 */
export function bufferToStream(buffer) {
  const readable = new stream.Readable();
  readable._read = () => {}; // _read is required but you can noop it
  readable.push(buffer);
  readable.push(null);
  return readable;
} 