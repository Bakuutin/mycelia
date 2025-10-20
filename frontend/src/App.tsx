import { useTheme } from './hooks/useTheme';
import { Outlet } from 'react-router-dom';

function App() {
  useTheme();
  return <Outlet />;
}

export default App;
