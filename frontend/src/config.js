// Configuration file for environment-specific settings

// Backend API URL based on environment
const API_BASE_URL = 
  import.meta.env.PROD 
    ? 'https://autoinvoice-ai-server.onrender.com' // Production URL
    : 'http://localhost:3001'; // Development URL

export { API_BASE_URL }; 