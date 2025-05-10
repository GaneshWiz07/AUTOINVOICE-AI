import React from 'react';
import { FiMail, FiRefreshCw, FiDownload } from 'react-icons/fi';

function ActionButtons({ 
  isLoading, 
  // processingMessage, // This will be handled by the global message display in App.jsx
  invoicesCount, 
  onProcessEmails, 
  onRefreshInvoices, 
  onDownloadExcel 
}) {
  return (
    <section className="action-buttons"> {/* Uses new section styling from App.css */}
      <div className="action-buttons-grid"> {/* For better layout of buttons */}
        <button onClick={onProcessEmails} disabled={isLoading} className="button-primary">
          <FiMail className="button-icon" /> 
          Process New Invoices
        </button>
        <button onClick={onRefreshInvoices} disabled={isLoading} className="button-secondary">
          <FiRefreshCw className="button-icon" /> 
          Refresh List
        </button>
        <button onClick={onDownloadExcel} disabled={isLoading || invoicesCount === 0} className="button-secondary">
          <FiDownload className="button-icon" /> 
          Download Excel
        </button>
      </div>
    </section>
  );
}

export default ActionButtons; 