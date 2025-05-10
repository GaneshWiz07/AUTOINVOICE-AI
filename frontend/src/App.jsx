import { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'
import AuthSection from './components/AuthSection'
import ActionButtons from './components/ActionButtons'
import InvoiceTable from './components/InvoiceTable'
import EditInvoiceModal from './components/EditInvoiceModal'
import SummaryCards from './components/SummaryCards'
import ActivityTimeline from './components/ActivityTimeline'

// Use environment variable for backend API URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'
console.log('Using API URL:', API_BASE_URL)

// Configure axios defaults
axios.defaults.withCredentials = true;

// SVG logo component for AutoInvoice AI
const Logo = () => (
  <svg 
    width="32" 
    height="32" 
    viewBox="0 0 32 32" 
    fill="none" 
    className="app-logo"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="6" y="4" width="20" height="24" rx="2" fill="currentColor" fillOpacity="0.2" />
    <path d="M10 10H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M10 14H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M10 18H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M19 21L21 23L25 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function App() {
  const [userInfo, setUserInfo] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [processingMessage, setProcessingMessage] = useState('')
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingInvoice, setEditingInvoice] = useState(null)
  const [theme, setTheme] = useState('light') // Add theme state
  const [hasLoadedInvoices, setHasLoadedInvoices] = useState(false) // Track if invoices have been loaded before

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Toggle theme function
  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }

  // Determine if we should show the centered layout
  // Only show welcome screen if we've never loaded invoices before
  const shouldUseCenteredLayout = userInfo && !hasLoadedInvoices && invoices.length === 0;

  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search)
    const email = queryParams.get('email')
    const token = queryParams.get('token')

    // Check for token from auth redirect
    if (token) {
      console.log('Auth token detected, exchanging for session...')
      exchangeToken(token)
      // Clear the URL params after processing
      window.history.replaceState({}, document.title, window.location.pathname)
      return
    }

    // Legacy email parameter handling
    if (email) {
      setUserInfo({ email })
      console.log('Logged in user:', email)
      window.history.replaceState({}, document.title, window.location.pathname)
      fetchInvoices() // Fetch invoices automatically on successful login redirect
    } else {
      // Optional: Check if user is already authenticated (e.g., via a backend check or stored token)
      checkAuthStatus()
    }
  }, [])

  // Exchange token for session
  const exchangeToken = async (token) => {
    setIsLoading(true)
    try {
      const response = await axios.get(`${API_BASE_URL}/api/exchange-token?token=${token}`, {
        withCredentials: true // Important to allow cookies to be set
      })
      if (response.data.success && response.data.user) {
        setUserInfo(response.data.user)
        console.log('Successfully authenticated:', response.data.user.email)
        fetchInvoices()
      } else {
        console.error('Token exchange failed:', response.data.message)
        setError('Authentication failed. Please try logging in again.')
      }
    } catch (err) {
      console.error('Error exchanging token:', err)
      setError('Authentication error. Please try logging in again.')
    } finally {
      setIsLoading(false)
    }
  }

  // Check if user is already authenticated
  const checkAuthStatus = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/me`, {
        withCredentials: true // Important to receive cookies
      })
      if (response.data.user) {
        setUserInfo(response.data.user)
        console.log('User already authenticated:', response.data.user.email)
        fetchInvoices()
      }
    } catch (err) {
      // User not authenticated, do nothing
      console.log('User not authenticated, showing login screen')
    }
  }

  const handleLogin = () => {
    window.location.href = `${API_BASE_URL}/auth/google`
  }

  const handleLogout = () => {
    // Simple frontend logout. A real app might need to call a backend endpoint 
    // to invalidate tokens/sessions.
    setUserInfo(null)
    setInvoices([]) // Clear invoices on logout
    setError(null)
    setProcessingMessage('')
    setHasLoadedInvoices(false) // Reset invoice loading state on logout
    
    // Call the backend logout endpoint
    axios.post(`${API_BASE_URL}/api/logout`, {}, { withCredentials: true })
      .then(() => console.log('User logged out successfully.'))
      .catch(err => console.error('Error during logout:', err))
  }

  const handleProcessEmails = async () => {
    setIsLoading(true)
    setError(null)
    setProcessingMessage('Processing emails... This may take a moment.')
    try {
      const response = await axios.get(`${API_BASE_URL}/process-emails`, { withCredentials: true })
      setProcessingMessage(response.data.message || 'Processing complete. Fetching updated invoices...')
      console.log('Process emails response:', response.data)
      await fetchInvoices() // Refresh invoice list after processing
    } catch (err) {
      console.error('Error processing emails:', err)
      setError(err.response?.data || 'Failed to process emails. Please ensure you are logged in and try again.')
      setProcessingMessage('')
    } finally {
      setIsLoading(false)
      // Optionally clear processing message after a delay
      // setTimeout(() => setProcessingMessage(''), 5000);
    }
  }

  const fetchInvoices = async () => {
    if (!userInfo && !window.location.search.includes('email=')) {
      // Don't try fetching if we know user isn't logged in
      // (unless just redirected - the effect handles that)
      // This check might need refinement depending on actual auth flow
      // console.log('User not logged in, skipping invoice fetch.');
      // return;
    } 
    setIsLoading(true)
    setError(null)
    try {
      const response = await axios.get(`${API_BASE_URL}/invoices`, { withCredentials: true })
      setInvoices(response.data || [])
      // Mark that we've loaded invoices at least once
      setHasLoadedInvoices(true)
      console.log('Fetched invoices:', response.data)
    } catch (err) {
      console.error('Error fetching invoices:', err)
      if (err.response?.status === 401) {
        setError('Authentication session may have expired. Please log in again.')
        handleLogout() // Log out user if auth fails
      } else {
        setError(err.response?.data?.message || err.message || 'Failed to fetch invoices.')
        setInvoices([]) // Clear invoices on error
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownloadExcel = () => {
    console.log('Triggering Excel download...')
    window.open(`${API_BASE_URL}/download-excel`, '_blank')
  }

  // --- CRUD Handlers ---
  const handleOpenEditModal = (invoice) => {
    console.log('Editing invoice:', invoice);
    setEditingInvoice(invoice);
    setIsEditModalOpen(true);
  };

  const handleCloseEditModal = () => {
    setEditingInvoice(null);
    setIsEditModalOpen(false);
  };

  const handleSaveInvoice = async (invoiceId, updatedData) => {
    setIsLoading(true);
    setError(null);
    try {
      console.log(`Saving invoice ${invoiceId} with data:`, updatedData);
      const response = await axios.put(`${API_BASE_URL}/api/invoices/${invoiceId}`, updatedData, { withCredentials: true });
      console.log('Update response:', response.data);
      handleCloseEditModal();
      await fetchInvoices(); // Refresh the list
      setProcessingMessage('Invoice updated successfully!');
    } catch (err) {
      console.error('Error updating invoice:', err);
      setError(err.response?.data?.message || err.message || 'Failed to update invoice.');
    } finally {
      setIsLoading(false);
      setTimeout(() => setProcessingMessage(''), 3000); // Clear message after a delay
    }
  };

  const handleDeleteInvoice = async (invoiceId) => {
    if (window.confirm('Are you sure you want to delete this invoice? This action cannot be undone.')) {
      setIsLoading(true);
      setError(null);
      try {
        console.log(`Deleting invoice ${invoiceId}`);
        await axios.delete(`${API_BASE_URL}/api/invoices/${invoiceId}`, { withCredentials: true });
        await fetchInvoices(); // Refresh the list
        setProcessingMessage('Invoice deleted successfully!');
      } catch (err) {
        console.error('Error deleting invoice:', err);
        setError(err.response?.data?.message || err.message || 'Failed to delete invoice.');
      } finally {
        setIsLoading(false);
        setTimeout(() => setProcessingMessage(''), 3000); // Clear message after a delay
      }
    }
  };

  const handleSetPending = async (invoiceId) => {
    console.log(`Setting invoice ${invoiceId} to pending.`);
    setIsLoading(true); // Indicate loading state
    setError(null);
    try {
      const response = await axios.put(`${API_BASE_URL}/api/invoices/${invoiceId}/status`, { status: 'pending' }, { withCredentials: true });
      console.log('Set pending response:', response.data);
      // Update local state with the modified invoice (or re-fetch)
      setInvoices(prevInvoices =>
        prevInvoices.map(inv =>
          inv.id === invoiceId ? { ...inv, status: 'pending' } : inv
        )
      );
      setProcessingMessage('Invoice marked as pending.');
    } catch (err) {
      console.error('Error setting invoice to pending:', err);
      setError(err.response?.data?.message || err.message || 'Failed to mark invoice as pending.');
    } finally {
      setIsLoading(false);
      setTimeout(() => setProcessingMessage(''), 3000); // Clear message after a delay
    }
  };
  // --- End CRUD Handlers ---

  return (
    <div className={`App ${shouldUseCenteredLayout ? 'centered-layout' : ''}`}>
      <header>
        <div className="brand">
          <Logo />
          <h1>AutoInvoice AI</h1>
        </div>
        <div className="theme-toggle" onClick={toggleTheme}>
          {theme === 'light' ? '🌙' : '☀️'}
        </div>
      </header>

      <main className="main-content">
        {userInfo && (
          <>
            {shouldUseCenteredLayout ? (
              <div className="loading-container">
                <h2>Welcome to AutoInvoice AI</h2>
                {isLoading ? (
                  <>
                    <p>{processingMessage || 'Loading your invoices...'}</p>
                  </>
                ) : (
                  <>
                    <p>No invoices found. Process emails to start extracting invoice data.</p>
                    <ActionButtons
                      isLoading={isLoading}
                      processingMessage={processingMessage}
                      invoicesCount={invoices.length}
                      onProcessEmails={handleProcessEmails}
                      onRefreshInvoices={fetchInvoices}
                      onDownloadExcel={handleDownloadExcel}
                    />
                  </>
                )}
              </div>
            ) : (
              <>
                <SummaryCards invoices={invoices} />
                <div className="invoice-table-container">
                  <ActionButtons
                    isLoading={isLoading}
                    processingMessage={processingMessage}
                    invoicesCount={invoices.length}
                    onProcessEmails={handleProcessEmails}
                    onRefreshInvoices={fetchInvoices}
                    onDownloadExcel={handleDownloadExcel}
                  />
                  
                  {error && <p className="error-message">Error: {typeof error === 'string' ? error : JSON.stringify(error)}</p>}
                  {!isLoading && processingMessage && !error && <p className="processing-message">{processingMessage}</p>}
                  
                  <div className="invoice-table-scroll">
                    <InvoiceTable 
                      invoices={invoices} 
                      isLoading={isLoading}
                      onEdit={handleOpenEditModal}
                      onDelete={handleDeleteInvoice}
                      onSetPending={handleSetPending}
                    />
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </main>

      <AuthSection 
        userInfo={userInfo} 
        isLoading={isLoading} 
        onLogin={handleLogin} 
        onLogout={handleLogout} 
      />

      {isEditModalOpen && editingInvoice && (
        <EditInvoiceModal 
          isOpen={isEditModalOpen}
          invoice={editingInvoice}
          onClose={handleCloseEditModal}
          onSave={handleSaveInvoice}
        />
      )}
    </div>
  )
}

export default App 