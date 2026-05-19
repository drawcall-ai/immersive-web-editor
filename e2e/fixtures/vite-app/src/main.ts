import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  config,
  string,
  val,
} from 'immersive-web-editor';
import './styles.css';

function App() {
  const scene = config('Scene', {
    title: val("Hello World", string()),
  });

  return React.createElement(
    'main',
    { className: 'app' },
    React.createElement('p', { className: 'eyebrow' }, 'Vite editor fixture'),
    React.createElement('h1', null, scene.title),
  );
}

createRoot(document.getElementById('root')!).render(
  React.createElement(React.StrictMode, null, React.createElement(App)),
);
