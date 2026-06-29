import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import PastPapers from './pages/PastPapers';
import Profile from './pages/Profile';
import Login from './pages/Login';
import Programs from './pages/programs';
import ProgramDetail from './pages/ProgramDetail.jsx';
import Quiz from './pages/Quiz.jsx';
import ProtectedRoute from './components/ProtectedRoute';
import Upload from './pages/Upload';
import Course from './pages/Course.jsx';
import Settings from './pages/Settings';
import Request from './pages/Request';
import InstallPrompt from './components/InstallPrompt';   // ✅ import

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/papers" element={<ProtectedRoute><PastPapers /></ProtectedRoute>} />
        <Route path="/course" element={<ProtectedRoute><Course /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/Request" element={<ProtectedRoute><Request /></ProtectedRoute>} />
        <Route path="/programs" element={<ProtectedRoute><Programs /></ProtectedRoute>} />
        <Route path="/program-detail" element={<ProtectedRoute><ProgramDetail /></ProtectedRoute>} />
        <Route path="/program-detail/:program" element={<ProtectedRoute><ProgramDetail /></ProtectedRoute>} />
        <Route path="/upload" element={<ProtectedRoute><Upload /></ProtectedRoute>} />
        <Route path="/quiz" element={<ProtectedRoute><Quiz /></ProtectedRoute>} />
      </Routes>
      <InstallPrompt />   {/* ✅ added here */}
    </BrowserRouter>
  );
}

export default App;