import React from 'react';
import { FiUpload, FiCheck, FiAlertCircle } from 'react-icons/fi';

const ActivityTimeline = ({ invoices }) => {
  const recentActivity = invoices
    .slice(0, 5)
    .map(inv => ({
      ...inv,
      icon: inv.status === 'processed' ? <FiCheck /> : <FiAlertCircle />,
      color: inv.status === 'processed' ? 'var(--success-color)' : 'var(--error-color)',
      date: inv.processed_at || inv.created_at
    }));

  return (
    <div className="timeline">
      <h2>Recent Activity</h2>
      {recentActivity.map((activity, i) => (
        <div key={i} className="timeline-item">
          <div className="timeline-icon" style={{ color: activity.color }}>
            {activity.icon}
          </div>
          <div className="timeline-content">
            <p>{activity.file_name || 'Untitled Invoice'}</p>
            <small>{activity.date ? new Date(activity.date).toLocaleString() : 'No date'}</small>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ActivityTimeline; 