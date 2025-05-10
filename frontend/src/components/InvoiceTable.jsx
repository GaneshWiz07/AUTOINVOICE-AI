import React from 'react';
import { FiEdit2, FiTrash2, FiExternalLink, FiFlag } from 'react-icons/fi';

function InvoiceTable({ invoices, onEdit, onDelete, onSetPending, isLoading }) {
  // Don't show anything when loading
  if (isLoading) {
    return null;
  }

  if (!invoices || invoices.length === 0) {
    return (
      <section className="invoice-list">
        <h2>Extracted Invoices</h2>
        <p className="info-message">No invoices found. Try processing emails or check back later.</p>
      </section>
    );
  }

  return (
    <section className="invoice-list">
      <h2>Extracted Invoices</h2>
      <table>
        <thead>
          <tr>
            <th>Inv. Number</th>
            <th>Vendor</th>
            <th>Amount</th>
            <th>Inv. Date</th>
            <th>File Name</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id || invoice.file_name}>
              <td>{invoice.invoice_number || 'N/A'}</td>
              <td>{invoice.vendor || 'N/A'}</td>
              <td>{invoice.amount ? `$${Number(invoice.amount).toFixed(2)}` : 'N/A'}</td>
              <td>{invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString() : 'N/A'}</td>
              <td>
                {invoice.file_url ? (
                  <a href={invoice.file_url} target="_blank" rel="noopener noreferrer">
                    {invoice.file_name} <FiExternalLink style={{ marginLeft: '4px', verticalAlign: 'middle'}}/>
                  </a>
                ) : (
                  invoice.file_name || 'N/A'
                )}
              </td>
              <td>{invoice.status || 'N/A'}</td>
              <td>
                {invoice.id && (
                  <>
                    <button onClick={() => onEdit(invoice)} className="button-small button-edit" title="Edit Invoice">
                      <FiEdit2 />
                    </button>
                    <button onClick={() => onDelete(invoice.id)} className="button-small button-delete" title="Delete Invoice">
                      <FiTrash2 />
                    </button>
                    <button onClick={() => onSetPending(invoice.id)} className="button-small button-pending" title="Mark as Pending">
                      <FiFlag />
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default InvoiceTable; 