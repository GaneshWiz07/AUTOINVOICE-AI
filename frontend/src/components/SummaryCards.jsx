import React from 'react';
import { FiDollarSign, FiPackage, FiClock, FiCheckCircle } from 'react-icons/fi';

const SummaryCards = ({ invoices }) => {
  // Calculate metrics
  const totalAmount = invoices.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);
  const processedCount = invoices.length;
  const pendingCount = invoices.filter(inv => inv.status === 'pending').length;
  const topVendor = invoices.reduce((acc, inv) => {
    if (!inv.vendor) return acc;
    acc[inv.vendor] = (acc[inv.vendor] || 0) + 1;
    return acc;
  }, {});

  const topVendorName = Object.keys(topVendor).length > 0 
    ? Object.entries(topVendor).sort((a,b) => b[1]-a[1])[0][0] 
    : 'N/A';

  return (
    <div className="invoice-summary">
      <div className="summary-card">
        <FiDollarSign size={24} className="card-icon" />
        <h3>Total Processed</h3>
        <p>${totalAmount.toFixed(2)}</p>
      </div>
      <div className="summary-card">
        <FiPackage size={24} className="card-icon" />
        <h3>Invoices</h3>
        <p>{processedCount}</p>
      </div>
      <div className="summary-card">
        <FiClock size={24} className="card-icon" />
        <h3>Pending</h3>
        <p>{pendingCount}</p>
      </div>
      <div className="summary-card">
        <FiCheckCircle size={24} className="card-icon" />
        <h3>Top Vendor</h3>
        <p>{topVendorName}</p>
      </div>
    </div>
  );
};

export default SummaryCards; 