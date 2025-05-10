# Autoinvoice AI

This project automatically extracts invoice data from Gmail, processes it with an AI model, stores the structured data in Supabase, and allows users to download the data as an Excel sheet.

**Tech Stack:**

*   **Frontend:** React + Vite
*   **Backend:** Express.js + Node.js
*   **Database & Storage:** Supabase
*   **AI Model:** Hugging Face Inference API
*   **Gmail Integration:** Google OAuth2
*   **Excel Export:** exceljs/xlsx 

## Setup Instructions

### 1. Clone the repository
```bash
git clone https://github.com/GaneshWiz07/AUTOINVOICE-AI.git
cd AUTOINVOICE-AI
```

### 2. Install dependencies
```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 3. Configure Google OAuth Credentials
1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Gmail API
4. Create OAuth credentials (Web application type)
5. Add authorized redirect URIs (e.g., http://localhost:3000/auth/google/callback)
6. Copy the `.env.example` file to `.env` in the backend directory:
   ```bash
   cp .env.example .env
   ```
7. Add your Google OAuth credentials to the `.env` file:
   ```
   GOOGLE_CLIENT_ID=your_client_id_here
   GOOGLE_CLIENT_SECRET=your_client_secret_here
   GOOGLE_REDIRECT_URI=your_redirect_uri_here
   ```

⚠️ **IMPORTANT: NEVER commit your `.env` file or any files containing credentials to Git!** ⚠️

### 4. Start the application
```bash
# Start backend server
cd backend
npm run dev

# In a separate terminal, start frontend
cd frontend
npm run dev
```

## License
See the [LICENSE](LICENSE) file for details. 