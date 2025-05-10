import { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'
import AuthSection from './components/AuthSection'
import ActionButtons from './components/ActionButtons'
import InvoiceTable from './components/InvoiceTable'
import EditInvoiceModal from './components/EditInvoiceModal'
import SummaryCards from './components/SummaryCards'
import ActivityTimeline from './components/ActivityTimeline'
import { API_BASE_URL } from './config' // Import API URL from config

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
    if (email) {
      setUserInfo({ email })
      console.log('Logged in user:', email)
      window.history.replaceState({}, document.title, window.location.pathname)
      fetchInvoices() // Fetch invoices automatically on successful login redirect
    } else {
      // Optional: Check if user is already authenticated (e.g., via a backend check or stored token)
      // For this app, we rely on the redirect or manual fetch after login.
    }
  }, [])

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
    // Optionally clear the token.json on the backend if possible/needed,
    // or manage tokens more robustly (e.g., HttpOnly cookies).
    console.log('User logged out (frontend only).')
    // Consider removing the local token.json file if implementing file system access in backend logout
    // Or better, manage tokens via sessions or secure cookies.
  }

  const handleProcessEmails = async () => {
    setIsLoading(true)
    setError(null)
    setProcessingMessage('Processing emails... This may take a moment.')
    try {
      const response = await axios.get(`${API_BASE_URL}/process-emails`)
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
      const response = await axios.get(`${API_BASE_URL}/invoices`)
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
      const response = await axios.put(`${API_BASE_URL}/api/invoices/${invoiceId}`, updatedData);
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
        await axios.delete(`${API_BASE_URL}/api/invoices/${invoiceId}`);
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
      const response = await axios.put(`${API_BASE_URL}/api/invoices/${invoiceId}/status`, { status: 'pending' });
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