import React from 'react';
import { FiLogOut, FiShield } from 'react-icons/fi';
import googleLogo from '../assets/google-logo.png';

// Simple, stateless component that directly renders what it receives
const AuthSection = ({ userInfo, isLoading, onLogin, onLogout }) => {
  // Debug email directly
  console.log('Current userInfo in AuthSection:', userInfo);
  
  // If not logged in, show login screen
  if (!userInfo || !userInfo.email) {
    return (
      <div className="centered-auth-container">
        <div className="signin-card">
          <div className="brand">
            <div className="app-logo">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M30 10H10C8.89543 10 8 10.8954 8 12V28C8 29.1046 8.89543 30 10 30H30C31.1046 30 32 29.1046 32 28V12C32 10.8954 31.1046 10 30 10Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M16 18L20 22L24 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1>AutoInvoice AI</h1>
          </div>
          <div className="signin-header">
            <h2>Welcome</h2>
            <p>Sign in to access your invoices</p>
          </div>
          <button 
            className="google-login-button" 
            onClick={onLogin} 
            disabled={isLoading}
          >
            <img 
              src={googleLogo}
              alt="Google Logo" 
              className="google-logo"
            />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  // Direct rendering with welcome text and status only
  return (
    <div className="sidebar">
      <div className="simple-profile-card">
        <div className="simple-avatar">
          <img src={googleLogo} alt="Google" className="google-avatar-image" />
        </div>
        
        <div className="welcome-text">Welcome back</div>
        
        <div className="simple-profile-info">
          <div className="simple-status-display">
            <FiShield />
            <span className="status-active">Active</span>
          </div>
        </div>
        
        <button onClick={onLogout} className="simple-logout-button">
          <FiLogOut />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
};

export default AuthSection;