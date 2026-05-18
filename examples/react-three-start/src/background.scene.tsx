import { color, config, val } from 'immersive-web-editor';

const background = config('Scene Background', val("#ffffff", color()));

export default function Background() {
  return <color attach="background" args={[background]} />;
}
