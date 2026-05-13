import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Panel, type EditorApi } from './Panel';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5_000,
    },
  },
});

export function activate(editor: EditorApi): () => void {
  const controller = document.createElement('div');
  controller.hidden = true;
  document.body.appendChild(controller);

  const root = createRoot(controller);
  root.render(
    <QueryClientProvider client={queryClient}>
      <Panel editor={editor} />
    </QueryClientProvider>,
  );

  return () => {
    root.unmount();
    controller.remove();
  };
}
