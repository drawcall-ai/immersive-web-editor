import { Fragment, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bot,
  Box,
  Brush,
  CheckSquare,
  Crosshair,
  Droplet,
  Eye,
  Film,
  Hash,
  Info,
  LayoutDashboard,
  Move3D,
  Paintbrush,
  Palette,
  Plus,
  Swords,
  Trash2,
  Type,
  UserRound,
  Users,
} from 'lucide-react';
import {
  BooleanField,
  ColorField,
  Editor,
  NumberField,
  StringField,
  Vector3Field,
  type EditorRoot,
  type FolderAction,
  type FolderSegment,
  type SlotPath,
} from '@iwe/ui';
import './styles.css';

const root: EditorRoot = {
  title: 'Editor',
  icon: <LayoutDashboard />,
  arrangement: 'nav-left-icons',
};

function inspectAction(title: string): FolderAction {
  return {
    id: 'inspect',
    label: `Inspect ${title}`,
    icon: <Info />,
    run: () => console.info(`Inspect ${title}`),
  };
}

function folder(segment: Omit<FolderSegment, 'actions'>, actions: readonly FolderAction[] = []): FolderSegment {
  return {
    ...segment,
    actions: [inspectAction(segment.title), ...actions],
  };
}

const scene = folder({ title: 'Scene', icon: <Box />, arrangement: 'nav-top' });
const materials = folder({ title: 'Materials', icon: <Palette />, arrangement: 'nav-left' });
const animation = folder({ title: 'Animation', icon: <Film />, arrangement: 'nav-bottom' });
const ai = folder({ title: 'AI', icon: <Bot />, arrangement: 'nav-top-icons' });

const sceneDock = folder({ title: 'Scene Dock', icon: <Box />, arrangement: 'dock-row' });
const lighting = folder({ title: 'Lighting', icon: <Droplet />, arrangement: 'stack' });
const characters = folder({ title: 'Characters', icon: <Users />, arrangement: 'tabs' });
const preview = folder({ title: 'Preview', icon: <Eye />, arrangement: 'stack' });
const hero = folder({ title: 'Hero NPC', icon: <UserRound />, arrangement: 'accordion' });
const transform = folder({ title: 'Transform', icon: <Move3D />, arrangement: 'stack' });
const materialGroup = folder({ title: 'Material', icon: <Paintbrush />, arrangement: 'stack' });
const identity = folder({ title: 'Identity', icon: <Crosshair />, arrangement: 'stack' });

const materialGrid = folder({ title: 'Material Grid', icon: <Palette />, arrangement: 'grid' });
const materialPresets = folder({ title: 'Presets', icon: <Paintbrush />, arrangement: 'stack' });
const heroMaterial = folder({ title: 'Hero Material', icon: <Paintbrush />, arrangement: 'stack' });
const worldMaterial = folder({ title: 'World Material', icon: <Palette />, arrangement: 'stack' });

const timelineDock = folder({ title: 'Timeline Dock', icon: <Film />, arrangement: 'dock-column' });
const clipRange = folder({ title: 'Clip Range', icon: <Film />, arrangement: 'stack' });
const playback = folder({ title: 'Playback', icon: <Film />, arrangement: 'stack' });
const animationEvents = folder({ title: 'Events', icon: <CheckSquare />, arrangement: 'stack' });

const promptFolder = folder({ title: 'Prompt', icon: <Brush />, arrangement: 'stack' });
const policySplit = folder({ title: 'Policy Split', icon: <CheckSquare />, arrangement: 'dock-row' });
const rules = folder({ title: 'Rules', icon: <CheckSquare />, arrangement: 'dock-column' });
const guardrails = folder({ title: 'Guardrails', icon: <Crosshair />, arrangement: 'stack' });
const style = folder({ title: 'Style', icon: <Palette />, arrangement: 'stack' });

function path(...segments: SlotPath): SlotPath {
  return segments;
}

function App() {
  const [state, setState] = useState({
    title: 'Config Lab',
    paused: false,
    heroName: 'Guard',
    heroTitle: 'Cartographer',
    heroHealth: 86,
    heroVisible: true,
    heroPosition: [-1.4, 0.8, 0] as [number, number, number],
    heroRotation: [0, 18, 0] as [number, number, number],
    heroScale: [1.1, 1.1, 1.1] as [number, number, number],
    heroColor: '#d66666',
    roughness: 0.42,
    ambientIntensity: 0.65,
    spawnEnabled: true,
    spawnRate: 12,
    enemies: [
      { id: 'scout', name: 'Scout', health: 42 },
      { id: 'brute', name: 'Brute', health: 78 },
    ],
    timelineStart: 0,
    timelineEnd: 140,
    playbackSpeed: 1,
    prompt: 'Make the guard look alert but not hostile.',
    safetyRule: 'Do not attack unless the player draws a weapon.',
    styleGuide: 'Low fantasy, dusty cloth, readable silhouette.',
    markerEvent: 'Footstep marker at frame 32',
  });

  const set = <K extends keyof typeof state>(key: K, value: (typeof state)[K]) => {
    setState((current) => ({ ...current, [key]: value }));
  };

  const addEnemy = () => {
    setState((current) => ({
      ...current,
      enemies: [
        ...current.enemies,
        { id: crypto.randomUUID(), name: `Enemy ${current.enemies.length + 1}`, health: 50 },
      ],
    }));
  };

  const removeEnemy = (id: string) => {
    setState((current) => ({
      ...current,
      enemies: current.enemies.filter((enemy) => enemy.id !== id),
    }));
  };

  const updateEnemy = (id: string, update: Partial<(typeof state.enemies)[number]>) => {
    setState((current) => ({
      ...current,
      enemies: current.enemies.map((enemy) => (enemy.id === id ? { ...enemy, ...update } : enemy)),
    }));
  };

  const enemies: FolderSegment = {
    title: 'Enemy Wave',
    icon: <Swords />,
    arrangement: 'accordion',
    actions: [
      inspectAction('Enemy Wave'),
      { id: 'add-enemy', label: 'Add enemy', icon: <Plus />, run: addEnemy },
      {
        id: 'delete-last-enemy',
        label: 'Delete last enemy',
        icon: <Trash2 />,
        disabled: state.enemies.length === 0,
        run: () => {
          const last = state.enemies[state.enemies.length - 1];
          if (last) removeEnemy(last.id);
        },
      },
    ],
  };

  return (
    <Editor root={root}>
      <StringField
        path={path(scene, sceneDock, preview, { title: 'Scene Title', icon: <Type /> })}
        value={state.title}
        onCommit={(value) => set('title', value)}
      />
      <BooleanField
        path={path(scene, sceneDock, preview, { title: 'Paused', icon: <CheckSquare /> })}
        value={state.paused}
        onCommit={(value) => set('paused', value)}
      />
      <ColorField
        path={path(scene, lighting, { title: 'Sky Tint', icon: <Droplet /> })}
        value="#87a9d9"
      />
      <NumberField
        path={path(scene, lighting, { title: 'Ambient Intensity', icon: <Hash /> })}
        value={state.ambientIntensity}
        min={0}
        max={1}
        step={0.01}
        onCommit={(value) => set('ambientIntensity', value)}
      />

      <StringField
        path={path(scene, sceneDock, characters, hero, identity, { title: 'Name', icon: <Type /> })}
        value={state.heroName}
        onCommit={(value) => set('heroName', value)}
      />
      <StringField
        path={path(scene, sceneDock, characters, hero, identity, { title: 'Title', icon: <Type /> })}
        value={state.heroTitle}
        onCommit={(value) => set('heroTitle', value)}
      />
      <NumberField
        path={path(scene, sceneDock, characters, hero, identity, { title: 'Health', icon: <Hash /> })}
        value={state.heroHealth}
        min={0}
        max={100}
        onCommit={(value) => set('heroHealth', value)}
      />
      <BooleanField
        path={path(scene, sceneDock, characters, hero, identity, { title: 'Visible', icon: <CheckSquare /> })}
        value={state.heroVisible}
        onCommit={(value) => set('heroVisible', value)}
      />
      <Vector3Field
        path={path(scene, sceneDock, characters, hero, transform, { title: 'Position', icon: <Move3D /> })}
        value={state.heroPosition}
        onCommit={(value) => set('heroPosition', value)}
      />
      <Vector3Field
        path={path(scene, sceneDock, characters, hero, transform, { title: 'Rotation', icon: <Move3D /> })}
        value={state.heroRotation}
        onCommit={(value) => set('heroRotation', value)}
      />
      <Vector3Field
        path={path(scene, sceneDock, characters, hero, transform, { title: 'Scale', icon: <Move3D /> })}
        value={state.heroScale}
        onCommit={(value) => set('heroScale', value)}
      />
      <ColorField
        path={path(scene, sceneDock, characters, hero, materialGroup, { title: 'Tint', icon: <Droplet /> })}
        value={state.heroColor}
        onCommit={(value) => set('heroColor', value)}
      />
      <NumberField
        path={path(scene, sceneDock, characters, hero, materialGroup, { title: 'Roughness', icon: <Hash /> })}
        value={state.roughness}
        min={0}
        max={1}
        step={0.01}
        onCommit={(value) => set('roughness', value)}
      />

      <BooleanField
        path={path(scene, sceneDock, characters, enemies, { title: 'Spawn Enabled', icon: <CheckSquare /> })}
        value={state.spawnEnabled}
        onCommit={(value) => set('spawnEnabled', value)}
      />
      <NumberField
        path={path(scene, sceneDock, characters, enemies, { title: 'Spawn Rate', icon: <Hash /> })}
        value={state.spawnRate}
        min={0}
        max={60}
        onCommit={(value) => set('spawnRate', value)}
      />

      {state.enemies.map((enemy) => {
        const enemyFolder: FolderSegment = {
          id: enemy.id,
          title: enemy.name,
          icon: <Swords />,
          arrangement: 'stack',
          actions: [
            inspectAction(enemy.name),
            { id: 'delete-enemy', label: `Delete ${enemy.name}`, icon: <Trash2 />, run: () => removeEnemy(enemy.id) },
          ],
        };

        return (
          <Fragment key={enemy.id}>
            <StringField
              path={path(scene, sceneDock, characters, enemies, enemyFolder, { title: 'Name', icon: <Type /> })}
              value={enemy.name}
              onCommit={(value) => updateEnemy(enemy.id, { name: value })}
            />
            <NumberField
              path={path(scene, sceneDock, characters, enemies, enemyFolder, { title: 'Health', icon: <Hash /> })}
              value={enemy.health}
              min={0}
              max={100}
              onCommit={(value) => updateEnemy(enemy.id, { health: value })}
            />
          </Fragment>
        );
      })}

      <ColorField
        path={path(materials, materialGrid, heroMaterial, { title: 'Hero Tint', icon: <Droplet /> })}
        value={state.heroColor}
        onCommit={(value) => set('heroColor', value)}
      />
      <NumberField
        path={path(materials, materialGrid, heroMaterial, { title: 'Hero Roughness', icon: <Hash /> })}
        value={state.roughness}
        min={0}
        max={1}
        step={0.01}
        onCommit={(value) => set('roughness', value)}
      />
      <ColorField
        path={path(materials, materialGrid, worldMaterial, { title: 'Sky Tint', icon: <Droplet /> })}
        value="#87a9d9"
      />
      <NumberField
        path={path(materials, materialGrid, worldMaterial, { title: 'Fog Density', icon: <Hash /> })}
        value={0.18}
        min={0}
        max={1}
        step={0.01}
      />
      <StringField
        path={path(materials, materialPresets, { title: 'Preset Name', icon: <Type /> })}
        value="Dusty Guard"
      />

      <NumberField
        path={path(animation, timelineDock, clipRange, { title: 'Timeline Start', icon: <Hash /> })}
        value={state.timelineStart}
        onCommit={(value) => set('timelineStart', value)}
      />
      <NumberField
        path={path(animation, timelineDock, clipRange, { title: 'Timeline End', icon: <Hash /> })}
        value={state.timelineEnd}
        onCommit={(value) => set('timelineEnd', value)}
      />
      <BooleanField
        path={path(animation, timelineDock, playback, { title: 'Loop', icon: <CheckSquare /> })}
        value
      />
      <NumberField
        path={path(animation, timelineDock, playback, { title: 'Speed', icon: <Hash /> })}
        value={state.playbackSpeed}
        min={0}
        max={4}
        step={0.1}
        onCommit={(value) => set('playbackSpeed', value)}
      />
      <StringField
        path={path(animation, animationEvents, { title: 'Marker Event', icon: <Type /> })}
        value={state.markerEvent}
        onCommit={(value) => set('markerEvent', value)}
      />

      <StringField
        path={path(ai, promptFolder, { title: 'Prompt', icon: <Brush />, align: 'start' })}
        value={state.prompt}
        onCommit={(value) => set('prompt', value)}
      />
      <StringField
        path={path(ai, policySplit, rules, guardrails, { title: 'Safety Rule', icon: <Crosshair />, align: 'start' })}
        value={state.safetyRule}
        onCommit={(value) => set('safetyRule', value)}
      />
      <StringField
        path={path(ai, policySplit, rules, style, { title: 'Style Guide', icon: <Palette />, align: 'start' })}
        value={state.styleGuide}
        onCommit={(value) => set('styleGuide', value)}
      />
    </Editor>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
