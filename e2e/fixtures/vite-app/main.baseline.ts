import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  array,
  boolean,
  color,
  config,
  fileUrl,
  json,
  number,
  object,
  optional,
  string,
  val,
  vec2,
  vec3,
} from 'immersive-web-editor';
import { mood } from './mood-field';
import './styles.css';

function App() {
  const text = config('Text', {
    title: val("Hello World", string({ placeholder: "Title" })),
    subtitle: val("Editable subtitle", string({ multiline: true })),
    count: val(3, number({ min: 0, max: 10, step: 1 })),
    enabled: val(true, boolean()),
    tint: val("#336699", color()),
    metadata: val({"variant":"alpha","score":1}, json()),
    mood: val("calm", mood()),
  });

  const layout = config('Layout', {
    offset: val([10,20], vec2({ step: 1 })),
    marker: val([1,2,3], vec3({ step: 0.5 })),
    card: val({"label":"Card A","size":2}, object({
      shape: {
        label: string(),
        size: number({ min: 1, max: 5, step: 1 }),
      },
    })),
    tags: val(["alpha"], array({
      item: string({ default: "new tag" }),
      itemLabel: "Tag",
      min: 1,
      max: 3,
    })),
    maybeNote: val(null, optional({ item: string({ default: "draft note" }) })),
    documentFile: val("existing.txt", fileUrl({ accept: ".txt", label: "Document file" })),
  });

  return React.createElement(
    'main',
    { className: 'app' },
    React.createElement('p', { className: 'eyebrow' }, 'Vite editor fixture'),
    React.createElement('h1', null, text.title),
    React.createElement('p', { 'data-testid': 'subtitle' }, text.subtitle),
    React.createElement('dl', { className: 'facts' },
      React.createElement('div', null, React.createElement('dt', null, 'Count'), React.createElement('dd', { 'data-testid': 'count' }, String(text.count))),
      React.createElement('div', null, React.createElement('dt', null, 'Enabled'), React.createElement('dd', { 'data-testid': 'enabled' }, text.enabled ? 'yes' : 'no')),
      React.createElement('div', null, React.createElement('dt', null, 'Tint'), React.createElement('dd', { 'data-testid': 'tint' }, text.tint)),
      React.createElement('div', null, React.createElement('dt', null, 'Mood'), React.createElement('dd', { 'data-testid': 'mood' }, text.mood)),
      React.createElement('div', null, React.createElement('dt', null, 'Metadata'), React.createElement('dd', { 'data-testid': 'metadata' }, `${text.metadata.variant}:${text.metadata.score}`)),
      React.createElement('div', null, React.createElement('dt', null, 'Offset'), React.createElement('dd', { 'data-testid': 'offset' }, textPair(layout.offset))),
      React.createElement('div', null, React.createElement('dt', null, 'Marker'), React.createElement('dd', { 'data-testid': 'marker' }, textTriple(layout.marker))),
      React.createElement('div', null, React.createElement('dt', null, 'Card'), React.createElement('dd', { 'data-testid': 'card' }, `${layout.card.label}:${layout.card.size}`)),
      React.createElement('div', null, React.createElement('dt', null, 'Tags'), React.createElement('dd', { 'data-testid': 'tags' }, layout.tags.join(','))),
      React.createElement('div', null, React.createElement('dt', null, 'Note'), React.createElement('dd', { 'data-testid': 'note' }, layout.maybeNote ?? 'none')),
      React.createElement('div', null, React.createElement('dt', null, 'File'), React.createElement('dd', { 'data-testid': 'file' }, layout.documentFile)),
    ),
  );
}

function textPair(value: readonly number[]): string {
  return `${value[0]},${value[1]}`;
}

function textTriple(value: readonly number[]): string {
  return `${value[0]},${value[1]},${value[2]}`;
}

createRoot(document.getElementById('root')!).render(
  React.createElement(React.StrictMode, null, React.createElement(App)),
);
