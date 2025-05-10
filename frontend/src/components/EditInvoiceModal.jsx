import React from 'react';
import { FiX } from 'react-icons/fi';

const EditInvoiceModal = ({ isOpen, invoice, onClose, onSave }) => {
  const [formData, setFormData] = React.useState({
    invoice_number: '',
    vendor: '',
    amount: '',
    invoice_date: '',
  });

  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }
    
    if (invoice) {
      setFormData({
        invoice_number: invoice.invoice_number || '',
        vendor: invoice.vendor || '',
        amount: invoice.amount || '',
        invoice_date: invoice.invoice_date ? new Date(invoice.invoice_date).toISOString().split('T')[0] : '',
      });
    }

    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, [isOpen, invoice]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(invoice.id, formData);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <button 
          onClick={onClose}
          className="modal-close-button"
        >
          <FiX />
        </button>

        <h2 className="modal-title">Edit Invoice</h2>

        <form onSubmit={handleSubmit} className="form">
          <div className="form-group">
            <label htmlFor="invoice_number">Invoice Number</label>
            <input
              type="text"
              id="invoice_number"
              name="invoice_number"
              value={formData.invoice_number}
              onChange={handleChange}
              required
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="vendor">Vendor</label>
            <input
              type="text"
              id="vendor"
              name="vendor"
              value={formData.vendor}
              onChange={handleChange}
              required
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="amount">Amount</label>
            <input
              type="number"
              id="amount"
              name="amount"
              value={formData.amount}
              onChange={handleChange}
              step="0.01"
              required
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="invoice_date">Invoice Date</label>
            <input
              type="date"
              id="invoice_date"
              name="invoice_date"
              value={formData.invoice_date}
              onChange={handleChange}
              required
              className="form-input"
            />
          </div>

          <div className="form-actions">
            <button type="button" onClick={onClose} className="button button-secondary">Cancel</button>
            <button type="submit" className="button">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditInvoiceModal; 