import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function EmailConfigPage() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to SMTP settings by default
    navigate('/dashboard/email-config/smtp', { replace: true });
  }, [navigate]);

  return (
    <div className="container mx-auto py-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Loading...</h1>
      </div>
    </div>
  );
}
