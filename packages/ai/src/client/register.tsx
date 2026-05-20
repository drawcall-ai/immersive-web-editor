import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Panel, type AiClientOptions, type EditorApi } from './Panel';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5_000,
    },
  },
});

export function activateAi(editor: EditorApi, options: AiClientOptions = {}): () => void {
  const controller = document.createElement('div');
  controller.hidden = true;
  document.body.appendChild(controller);

  const root = createRoot(controller);
  root.render(
    <QueryClientProvider client={queryClient}>
      <Panel editor={editor} options={options} />
    </QueryClientProvider>,
  );

  return () => {
    root.unmount();
    controller.remove();
  };
}

export function activate(editor: EditorApi): () => void {
  return activateAi(editor);
}
