import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import WorkspacePage from '@/pages/WorkspacePage/WorkspacePage';
import ImageEditorPage from '@/pages/ImageEditorPage/ImageEditorPage';
import LibraryPage from '@/pages/LibraryPage/LibraryPage';
import CharactersPage from '@/pages/CharactersPage/CharactersPage';
import ModelHubPage from '@/pages/ModelHubPage/ModelHubPage';
import NotFoundPage from '@/pages/NotFoundPage/NotFoundPage';
import AuthModal from '@/components/AuthModal';

export default function App() {
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<WorkspacePage />} />
          <Route path="library/:category?" element={<LibraryPage />} />
          <Route path="characters" element={<CharactersPage />} />
          <Route path="model-hub" element={<ModelHubPage />} />
          <Route path="edit/:id" element={<ImageEditorPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <AuthModal />
    </>
  );
}
