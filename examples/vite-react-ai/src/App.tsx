import {
  array,
  boolean as bool,
  color,
  config,
  number,
  object,
  optional,
  position3D,
  rotation3D,
  scale3D,
  string,
  val,
} from 'immersive-web-editor';
import { mood } from './custom-fields';

export function App() {
  const scene = config('Scene', {
    title: val("Hello World"),
    paused: val(false, bool()),
    background: val("#000000", color()),
    exposure: val(2, number(0.82, { min: 0, max: 2, step: 0.01 })),
    camera: {
      position: val([0,0,0], position3D([0, 3, 8])),
      target: val([0, 1, 0], position3D([0, 1, 0])),
    },
  });

  const hero = config('Hero NPC', {
    name: val("wtf!"),
    title: val(null, optional(string("The Cartographer"))),
    health: val(20, number(100, { min: 0, max: 100, step: 1 })),
    mood: val("calm", mood("alert")),
    visible: val(true, bool()),
    transform: {
      position: val([-5.4,-3.2,0], position3D([-1.4, 0.8, 0])),
      rotation: val([0, 18, 0], rotation3D([0, 0, 0])),
      scale: val([1.1, 1.1, 1.1], scale3D([1, 1, 1])),
    },
    material: {
      color: val("#df2a2a", color("#65d6ad")),
      glow: val(0.56, number(0.5, { min: 0, max: 1, step: 0.01 })),
    },
  });

  const wave = config('Enemy Wave', {
    spawnEnabled: val(true, bool()),
    spawnPoint: val([2.2,-1.6,-1], position3D([2, 0, 0])),
    enemies: val([{"name":"Enemy","health":50,"position":[0,0,0],"color":"#ff5555"},{"name":"Enemy 3","health":50,"position":[4,0,0],"color":"#ff5555"}], array(object({
      name: string("Enemy"),
      health: number(50, { min: 0, max: 100, step: 1 }),
      position: position3D([0, 0, 0]),
      color: color("#ff5555"),
    }), { itemLabel: 'Enemy' })),
  });

  const heroTransform = {
    transform: `translate(${hero.transform.position[0] * 42}px, ${-hero.transform.position[1] * 34}px) rotate(${hero.transform.rotation[1]}deg) scale(${hero.transform.scale[0]})`,
    opacity: hero.visible ? 1 : 0.25,
  };

  return (
    <main className="app" style={{ backgroundColor: scene.background }}>
      <section className="workbench">
        <div className="stage-header">
          <div>
            <p className="eyebrow">Runtime registered controls</p>
            <h1>{scene.title}</h1>
          </div>
          <div className="status-pill" data-paused={scene.paused}>
            {scene.paused ? 'Paused' : 'Live'}
          </div>
        </div>

        <div className="stage" style={{ filter: `brightness(${scene.exposure + 0.35})` }}>
          <div className="grid-plane" />
          <div className="camera-pin" style={{ left: `${50 + scene.camera.target[0] * 6}%`, top: `${50 - scene.camera.target[1] * 8}%` }}>
            target
          </div>

          <article className="npc hero-npc" style={heroTransform}>
            <span className="npc-glow" style={{ backgroundColor: hero.material.color, opacity: hero.material.glow }} />
            <span className="npc-avatar" style={{ borderColor: hero.material.color }}>{hero.name.slice(0, 1)}</span>
            <strong>{hero.name}</strong>
            <small>{hero.mood} / {hero.title ?? 'No title assigned'}</small>
            <meter min="0" max="100" value={hero.health} />
          </article>

          {wave.enemies.map((enemy, index) => (
            <article
              className="npc enemy"
              key={`${enemy.name}-${index}`}
              style={{
                transform: `translate(${enemy.position[0] * 54}px, ${-enemy.position[1] * 42}px)`,
                opacity: wave.spawnEnabled ? 1 : 0.2,
              }}
            >
              <span className="enemy-dot" style={{ backgroundColor: enemy.color }} />
              <strong>{enemy.name}</strong>
              <small>{enemy.health} hp</small>
            </article>
          ))}

          <div
            className="spawn-point"
            style={{
              transform: `translate(${wave.spawnPoint[0] * 48}px, ${-wave.spawnPoint[1] * 40}px)`,
              opacity: wave.spawnEnabled ? 1 : 0.25,
            }}
          >
            spawn
          </div>
        </div>

        <div className="summary">
          <div>
            <span>Camera</span>
            <strong>{scene.camera.position.join(', ')}</strong>
          </div>
          <div>
            <span>Hero Position</span>
            <strong>{hero.transform.position.join(', ')}</strong>
          </div>
          <div>
            <span>Enemies</span>
            <strong>{wave.enemies.length}</strong>
          </div>
        </div>
      </section>
    </main>
  );
}
