import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ActivateAgent(props) {
  const navigate = useNavigate();
  useEffect(() => { navigate('/bots', { replace: true }); }, [navigate]);
  return null;
}
