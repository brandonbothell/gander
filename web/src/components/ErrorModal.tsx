import React from 'react';

interface ErrorModalProps {
  open: boolean;
  message: string;
  onClose: () => void;
}

const ErrorModal: React.FC<ErrorModalProps> = ({ open, message, onClose }) => {
  if (!open) return null;
  return (
    <div className="error-modal-backdrop">
      <div className="error-modal">
        <h3>Error</h3>
        <p>{message}</p>
        <button className="error-modal-btn" onClick={onClose}>OK</button>
      </div>
    </div>
  );
};

export default ErrorModal;
