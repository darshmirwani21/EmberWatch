import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import './premium.css';
import './business.css';
import './history.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
