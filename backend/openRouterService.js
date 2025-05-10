import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { Poppler } from 'node-poppler';

dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
// const DEFAULT_MODEL = 'nousresearch/nous-hermes-2-vision-7b'; // Old model
const DEFAULT_MODEL = 'openai/gpt-4o-mini'; // Changed to gpt-4o-mini

/**
 * Sends a single image buffer to OpenRouter for invoice data extraction.
 * @param {Buffer} imageBuffer - The buffer of the image.
 * @param {string} mimeType - The MIME type of the image.
 * @param {string} pageContext - Information about the page (e.g., "page 1 of 3").
 * @returns {Promise<object|null>} Parsed JSON from LLM or an error object.
 */
async function extractDataFromImagePage(imageBuffer, mimeType, pageContext) {
    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    const prompt = `
You are an expert invoice data extraction assistant.
Given the following image of an invoice page (${pageContext}), please extract the following information:
- Invoice Number (invoice_number)
- Invoice Date (invoice_date, in YYYY-MM-DD format if possible, otherwise as seen)
- Vendor Name (vendor_name)
- Total Amount Due (total_amount, as a number, e.g., 123.45)
- Due Date (due_date, in YYYY-MM-DD format if possible, otherwise as seen, can be null)
- Currency (currency, e.g., USD, EUR, if visible, otherwise guess or null)

If a field is not present or cannot be determined on this page, use null for its value.
Please return the information ONLY as a valid JSON object. Do not include any explanations or leading/trailing text outside the JSON object.

Example JSON output:
{
  "invoice_number": "INV-2023-001",
  "invoice_date": "2023-10-26",
  "vendor_name": "Example Corp",
  "total_amount": 150.75,
  "due_date": "2023-11-10",
  "currency": "USD"
}
`;

    console.log(`Sending request to OpenRouter for ${pageContext} with model: ${DEFAULT_MODEL}`);
    const response = await axios.post(
        OPENROUTER_API_URL,
        {
            model: DEFAULT_MODEL,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        {
                            type: 'image_url',
                            image_url: { url: dataUrl },
                        },
                    ],
                },
            ],
        },
        {
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
            },
        }
    );

    if (response.data && response.data.choices && response.data.choices.length > 0) {
        const messageContent = response.data.choices[0].message.content;
        console.log(`Raw response from LLM for ${pageContext}:`, messageContent);
        try {
            let jsonString = messageContent;
            const jsonMatch = messageContent.match(/```json\\n([\s\S]*?)\\n```|({[\s\S]*})/);
            if (jsonMatch) {
                jsonString = jsonMatch[1] || jsonMatch[2];
            }
            const extractedJson = JSON.parse(jsonString);
            console.log(`Successfully parsed JSON from LLM for ${pageContext}:`, extractedJson);
            return { ...extractedJson, llm_model: DEFAULT_MODEL, page_context: pageContext };
        } catch (parseError) {
            console.error(`Failed to parse JSON from LLM response for ${pageContext}:`, parseError);
            return { 
                error: 'LLM Response Parsing Error', 
                message: 'Failed to parse JSON output from LLM.',
                raw_response: messageContent,
                page_context: pageContext 
            };
        }
    } else {
        console.error(`Invalid response structure from OpenRouter for ${pageContext}:`, response.data);
        return { error: 'OpenRouter API Error', message: 'No choices or invalid response.', page_context: pageContext };
    }
}

/**
 * Extracts invoice data from an image or PDF file buffer using a multimodal LLM via OpenRouter.
 * For PDFs, it converts all pages to images and processes each one.
 * @param {Buffer} originalFileBuffer - The buffer of the invoice file.
 * @param {string} originalMimeType - The MIME type of the file.
 * @returns {Promise<object|null>} Consolidated extracted fields or an error object.
 */
async function extractInvoiceDataWithOpenRouter(originalFileBuffer, originalMimeType) {
    if (!OPENROUTER_API_KEY) {
        console.error('OpenRouter API key is missing.');
        return { error: 'Configuration Error', message: 'OpenRouter API key missing.' };
    }

    let tempDir = null;
    const allPagesData = [];

    try {
        if (originalMimeType === 'application/pdf') {
            console.log('Processing PDF: converting all pages to PNG...');
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'invoice-pdf-'));
            const tempPdfPath = path.join(tempDir, `${uuidv4()}.pdf`);
            const imageOutputBase = path.join(tempDir, 'page');

            await fs.writeFile(tempPdfPath, originalFileBuffer);
            console.log(`Temporary PDF saved to: ${tempPdfPath}`);

            const poppler = new Poppler();
            const pdfToCairoOptions = {
                pngFile: true,
                singleFile: false,
                cropBox: true,
                jpegFile: false
            };
            
            await poppler.pdfToCairo(tempPdfPath, path.join(tempDir, 'page'), pdfToCairoOptions);
            console.log('PDF to PNG conversion process completed.');

            const filesInTempDir = await fs.readdir(tempDir);
            const imageFiles = filesInTempDir
                .filter(f => /^page-\d+\.png$/.test(f))
                .sort((a, b) => {
                    const matchA = a.match(/page-(\d+)\.png/);
                    const matchB = b.match(/page-(\d+)\.png/);

                    // Default to a large number if pattern is not matched, to sort them last or handle error
                    const pageNumA = matchA ? parseInt(matchA[1]) : Infinity;
                    const pageNumB = matchB ? parseInt(matchB[1]) : Infinity;

                    if (pageNumA === Infinity && matchA === null) {
                        console.warn(`Filename ${a} does not match expected pattern and will be ignored in sorting.`);
                    }
                    if (pageNumB === Infinity && matchB === null) {
                        console.warn(`Filename ${b} does not match expected pattern and will be ignored in sorting.`);
                    }

                    return pageNumA - pageNumB;
                });
            
            if (imageFiles.length === 0) {
                throw new Error('No PNG images found after PDF conversion. PDF conversion might have failed or PDF was empty.');
            }
            console.log(`Found ${imageFiles.length} page(s) converted from PDF.`);

            for (let i = 0; i < imageFiles.length; i++) {
                const imagePath = path.join(tempDir, imageFiles[i]);
                const pageBuffer = await fs.readFile(imagePath);
                const pageContext = `page ${i + 1} of ${imageFiles.length}`;
                const pageData = await extractDataFromImagePage(pageBuffer, 'image/png', pageContext);
                if (pageData) allPagesData.push(pageData);
            }

        } else if (originalMimeType.startsWith('image/')) {
            console.log('Processing direct image...');
            const pageData = await extractDataFromImagePage(originalFileBuffer, originalMimeType, 'page 1 of 1');
            if (pageData) allPagesData.push(pageData);
        } else {
            console.warn(`Unsupported MIME type: ${originalMimeType}.`);
            return { status: 'unsupported_format', message: `Unsupported file type: ${originalMimeType}.` };
        }

        // Consolidate data from all pages
        if (allPagesData.length === 0) {
            return { error: 'Extraction Failed', message: 'No data could be extracted from any page.' };
        }

        const consolidatedData = {
            invoice_number: null,
            invoice_date: null,
            vendor_name: null,
            total_amount: null,
            due_date: null,
            currency: null,
            llm_model: DEFAULT_MODEL, // Assuming same model for all pages
            processed_pages: allPagesData.length,
            page_data_summary: [] // To store individual page results if needed for debugging
        };

        // Simple consolidation: take the first non-null value encountered for each field
        const fieldsToConsolidate = ['invoice_number', 'invoice_date', 'vendor_name', 'total_amount', 'due_date', 'currency'];
        
        for (const pageResult of allPagesData) {
            // Log a summary of what was extracted from each page for easier debugging
            consolidatedData.page_data_summary.push({
                page_context: pageResult.page_context,
                invoice_number: pageResult.invoice_number || null,
                invoice_date: pageResult.invoice_date || null,
                vendor_name: pageResult.vendor_name || null,
                total_amount: pageResult.total_amount || null,
                due_date: pageResult.due_date || null,
                currency: pageResult.currency || null,
                has_error: !!pageResult.error
            });

            if (pageResult.error) continue; // Skip pages with errors for consolidation of main fields

            for (const field of fieldsToConsolidate) {
                if (consolidatedData[field] === null && pageResult[field] !== null && pageResult[field] !== undefined) {
                    consolidatedData[field] = pageResult[field];
                }
            }
        }
        // A special case for total_amount: often appears only once, usually towards the end or on a summary page.
        // If multiple total_amounts are found, this simple consolidation might not be ideal.
        // For now, the first non-null is taken. More advanced logic could pick largest, last, etc.

        console.log('Consolidated Extraction Data:', consolidatedData);
        return consolidatedData;

    } catch (error) {
        console.error('Overall error in extractInvoiceDataWithOpenRouter:', error);
        return { 
            error: 'Overall Extraction Process Failed', 
            message: error.message 
        };
    } finally {
        if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true })
                .then(() => console.log(`Successfully cleaned up temp directory: ${tempDir}`))
                .catch(cleanupError => console.error(`Error cleaning up temp directory ${tempDir}:`, cleanupError));
        }
    }
}

export {
    extractInvoiceDataWithOpenRouter,
}; 